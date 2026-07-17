# Hardware Wiring — PMS7003 + WeMos D1 R1

This document covers the **physical build** of the sensor node: bill of materials, pin map, power, UART wiring, and boot-safety rationale. The firmware running on the MCU is in `../src/main.cpp`.

## Bill of materials

| # | Component | Notes |
|---|-----------|-------|
| 1 | **WeMos D1 R1** (ESP8266, 4 MB flash) | Hosts firmware, provides Wi-Fi + 3.3V GPIO + 5V rail from USB |
| 2 | **PMS7003** particulate-matter sensor | Needs **5 V** supply; logic-level RX/TX are 3.3V TTL |
| 3 | Half-size breadboard | For prototyping |
| 4 | 6 × M-M jumper wires | UART (3) + power (3, or use the breadboard power rails) |
| 5 | Micro-USB cable | Power + programming (data-capable, not charge-only) |

No level shifter is needed — PMS7003 RX accepts 3.3V high level directly per its datasheet (`H > 2.7V @ 3.3V`).

## Pin map (WeMos D1 R1 ↔ PMS7003)

| PMS7003 pin | Wire colour (suggested) | WeMos D1 R1 | ESP8266 GPIO | Role |
|---|---|---|---|---|
| **PIN1** VCC | red | `5V` (a.k.a. `Vin`) | — | Power **+5V** |
| **PIN2** VCC | red | `5V` (a.k.a. `Vin`) | — | Power **+5V** (tie both) |
| **PIN3** GND | black | `GND` | — | Power GND |
| **PIN4** GND | black | `GND` | — | Power GND (tie both) |
| **PIN5** RESET | — | (leave floating) | — | Internally pulled up; do not connect |
| **PIN6** NC | — | (no connection) | — | Not connected per datasheet |
| **PIN7** RX | yellow | `D7` | **GPIO13** | ESP TX → sensor RX |
| **PIN8** NC | — | (no connection) | — | Not connected per datasheet |
| **PIN9** TX | green | `D5` | **GPIO14** | ESP RX ← sensor TX |
| **PIN10** SET | — | (leave floating) | — | Internally pulled up; HIGH or floating = normal, LOW = sleep |

> The firmware uses `SoftwareSerial` on GPIO14 (RX) and **GPIO13** (TX), per `src/main.cpp:109`.

## Power

PMS7003 has its own fan and laser driver. It **must** be powered from the D1 R1's `5V`/`Vin` pin (which carries the USB 5 V rail).

| Parameter | Value |
|---|---|
| Supply voltage | **Typ 5.0 V**, Min 4.5 V, Max 5.5 V |
| Active current | ≤ 100 mA |
| Standby current | ≤ 200 µA |
| UART level | 3.3V TTL (`L < 0.8V`, `H > 2.7V`) |

⚠️ **Do not** power PMS7003 from the 3.3V rail. The fan will not spin and readings will be invalid; long-term under-voltage can damage the sensor.

## UART wiring

```
  PMS7003                    WeMos D1 R1
  +-------+                  +---------+
  |       |   yellow (TX)    |         |
  | PIN7  | <---------------- | D7      |  GPIO13 (ESP TX -> sensor RX)
  |  RX   |                  |         |
  +-------+                  +---------+
  |       |   green  (RX)    |         |
  | PIN9  | ----------------> | D5      |  GPIO14 (ESP RX <- sensor TX)
  |  TX   |                  |         |
  +-------+                  +---------+
```

Baud rate: **9600**, parity: **none**, stop bits: **1** (`SWSERIAL_8N1` in firmware). Matches the PMS7003 transport-protocol default.

## Breadboard sketch

```
        +--- USB ---+                              +--- 5V ---+
        |           |                              |          |
        |  WeMos    |       yellow                 | PMS7003  |
        | D7 (13)   |-----[====]------------------>| PIN7 RX  |
        |           |                              |          |
        |  D5 (14)  |<----[====]-------------------| PIN9 TX  | green
        |           |                              |          |
        |  GND      |------------------------------| PIN3 GND |
        |           |------------------------------| PIN4 GND |
        |           |                              |          |
        |  5V (Vin) |------------------------------| PIN1 VCC |
        |           |------------------------------| PIN2 VCC |
        +-----------+                              +----------+
                                                       |
                                                  (fan inlet/outlet
                                                   to ambient air)
```

## Boot-safety: which GPIOs to avoid and why

The ESP8266 uses several GPIOs as **boot strapping pins**. Their state at reset determines boot mode. Driving them with external hardware at boot can brick or wedge the chip.

| GPIO | D-label | Boot role | Verdict |
|---|---|---|---|
| GPIO0 | D3 | Must be **HIGH** at boot for normal run, **LOW** for flash mode. Pulled up on D1 R1. | **Avoid** for any sensor wiring. |
| GPIO2 | D4 | Must be **HIGH** at boot (pulled up). Used for onboard LED on D1 R1. | **Avoid**. |
| GPIO15 | D8 | Must be **LOW** at boot (pulled down). | **Avoid**. |
| **GPIO12** | D6 | Selects **flash voltage** (HIGH = 3.3V, LOW = 1.8V). If held LOW at boot, flash operations may corrupt. | **Avoid** — was the previous choice; moved to GPIO13. |
| **GPIO13** | D7 | Free of boot constraints. | ✅ Used for TX. |
| **GPIO14** | D5 | Free of boot constraints. | ✅ Used for RX. |

## First-power-up behaviour

Per the PMS7003 datasheet:

> Stable data should be got at least **30 seconds** after the sensor wake-up from the sleep mode because of the fan's performance.

In practice this also applies to cold power-up: the fan spins up over a few seconds, and readings within the first ~30 s may be lower than the true ambient concentration. If you need accurate first readings, ignore samples until `millis() > 30000` after boot.

## Sanity check before flashing

1. Plug in the D1 R1 via USB. The onboard LED should blink once.
2. Open the Arduino IDE or `pio device monitor -b 9600` and confirm the ESP boots cleanly (no `rst cause:4` / `wdt reset` spam).
3. With PMS7003 **unpowered**, connect TX/RX wires and confirm the sensor's TX line idles HIGH (PMS7003 UART is push-pull, idle-high).
4. Power the PMS7003 from `5V`. The fan should start spinning within ~2 s.
5. After ~30 s of warm-up you should see frames in the serial monitor at ~2.3 s intervals (stable mode) when concentration is stable.

## What can go wrong

| Symptom | Likely cause |
|---|---|
| Sensor never appears on serial | Wiring reversed (TX↔TX), or 5V not connected |
| Readings stuck at `0 0 0` | Fan not spinning (under-voltage on VCC) |
| WDT resets every few seconds | Pin conflict with a boot-strap GPIO — see table above |
| Supabase returns `401` | `SUPABASE_KEY` is empty or wrong — fill in `secrets.ini` |
| Supabase returns `404` | URL path is wrong; should be `https://<project>.supabase.co/rest/v1/pm_logs` |

## References

- [PMS7003 datasheet (V2.5)](https://download.kamami.pl/p564008-PMS7003%20series%20data%20manua_English_V2.5.pdf) — transport protocol, electrical specs
- [`fu-hsi/PMS` library](https://github.com/fu-hsi/PMS) — Arduino parser used by the firmware
- [ESP8266 boot-mode documentation](https://github.com/esp8266/esp8266-wiki/wiki/Boot-Process)
