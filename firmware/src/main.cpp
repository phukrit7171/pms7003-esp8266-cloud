#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SoftwareSerial.h>
#include <PMS.h>
#include <optional>

// Configs (Static Memory)
constexpr auto ssid              = "Phukrit";
constexpr auto password          = "";
constexpr auto supabase_url      = "https://wvvfbosiwsevcroxbmod.supabase.co/rest/v1/pm_logs";
constexpr auto supabase_anon_key = "";
constexpr uint32_t upload_interval = 60000;

static char auth_token_buffer[512] = {0};

SoftwareSerial pmsSerial;
PMS pms(pmsSerial);
PMS::DATA data;

struct PmData {
    int16_t pm1;
    int16_t pm2_5;
    int16_t pm10;
};

std::optional<PmData> latest_data = std::nullopt;
uint32_t last_upload_time = 0;

// ==========================================
// TASK 1: อ่านค่าจากเซนเซอร์ (ทำงานอิสระ 100% ไม่สนเน็ต)
// ==========================================
void taskReadSensor() {
    if (pms.read(data)) {
        latest_data = PmData{
            .pm1   = static_cast<int16_t>(data.PM_AE_UG_1_0),
            .pm2_5 = static_cast<int16_t>(data.PM_AE_UG_2_5),
            .pm10  = static_cast<int16_t>(data.PM_AE_UG_10_0)
        };

        // 🌟 พิมพ์ออกหน้าจอซีเรียลทันทีที่วัดได้! ต่อให้ไม่มีเน็ต ข้อมูลตรงนี้ก็ยังวิ่งตลอด
        Serial.printf("[Sensor Task] Local Realtime -> PM1: %d | PM2.5: %d | PM10: %d\n",
                      latest_data->pm1, latest_data->pm2_5, latest_data->pm10);
    }
}

// ==========================================
// TASK 2: ส่งข้อมูลเข้า Cloud (ทำงานเบื้องหลัง)
// ==========================================
void taskUploadToCloud() {
    const auto current_time = millis();

    if (current_time - last_upload_time >= upload_interval) {
        last_upload_time = current_time;

        // 🌟 จุดเช็คพอยต์ 1: ถ้าเน็ตยังไม่ต่อ หรือหลุดไป ให้ข้ามงานนี้ไปเลย ไม่ต้องจอดรอ
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println(F("[Cloud Task] Offline Mode: Skip upload. (WiFi disconnected)"));
            return;
        }

        // 🌟 จุดเช็คพอยต์ 2: ถ้าเน็ตมี แต่ยังไม่มีค่าจากเซนเซอร์ส่งมา ก็ให้ข้ามไป
        if (!latest_data.has_value()) {
            Serial.println(F("[Cloud Task] Skip upload: No new sensor data yet."));
            return;
        }

        Serial.println(F("[Cloud Task] Online! Uploading to Supabase..."));

        const auto [pm1, pm2_5, pm10] = latest_data.value();
        char json_payload[128];
        snprintf(json_payload, sizeof(json_payload),
                 "{\"pm1\":%d,\"pm2_5\":%d,\"pm10\":%d}",
                 pm1, pm2_5, pm10);

        WiFiClientSecure client;
        client.setInsecure();

        HTTPClient http;
        http.begin(client, supabase_url);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("apikey", supabase_anon_key);
        http.addHeader("Authorization", auth_token_buffer);

        int httpResponseCode = http.POST(reinterpret_cast<uint8_t*>(json_payload), strlen(json_payload));
        Serial.printf("[Cloud Task] Response Code: %d\n", httpResponseCode);

        http.end();
        latest_data = std::nullopt; // เคลียร์กล่องรับค่า
    }
}

void setup() {
    Serial.begin(9600);
    pmsSerial.begin(9600, SWSERIAL_8N1, 14, 12);

    snprintf(auth_token_buffer, sizeof(auth_token_buffer), "Bearer %s", supabase_anon_key);

    // 🌟 [ปลดล็อกคอขวด] สั่งเริ่มเชื่อมต่อ WiFi แบบทิ้งไว้ข้างหลังบ้าน แล้วปล่อยผ่านทันที!
    Serial.println(F("Starting WiFi connection in background..."));
    WiFi.begin(ssid, password);

    Serial.println(F("System Ready! Starting main loops."));
}

void loop() {
    // ทั้งสองฟังก์ชันจะทำงานวนลูปคู่ขนานกันไปโดยไม่ขัดขาใคร
    taskReadSensor();
    taskUploadToCloud();
}
