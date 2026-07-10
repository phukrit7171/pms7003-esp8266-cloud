#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SoftwareSerial.h>
#include <PMS.h>
#include <optional>

// 1. Static/Compile-time memory allocations
constexpr auto ssid              = "YOUR_WIFI_SSID";
constexpr auto password          = "YOUR_WIFI_PASSWORD";
constexpr auto supabase_url      = "https://your-project-id.supabase.co/rest/v1/pm_logs";
constexpr auto supabase_anon_key = "YOUR_SUPABASE_ANON_KEY";
constexpr uint32_t upload_interval = 60000;

// สร้างบัฟเฟอร์ขนาดคงที่ไว้ในหน่วยความจำ Static สำหรับเก็บ Authorization Header
// ป้องกันการสร้าง String ใหม่ทุกครั้งที่จะส่งข้อมูล
static char auth_token_buffer[512] = {0};

SoftwareSerial pmsSerial(D2, D3);
PMS pms(pmsSerial);
PMS::DATA data;

struct PmData {
    int16_t pm1;
    int16_t pm2_5;
    int16_t pm10;
};

std::optional<PmData> latest_data = std::nullopt;
uint32_t last_upload_time = 0;

void taskReadSensor() {
    if (pms.read(data)) {
        latest_data = PmData{
            .pm1   = static_cast<int16_t>(data.PM_AE_UG_1_0),
            .pm2_5 = static_cast<int16_t>(data.PM_AE_UG_2_5),
            .pm10  = static_cast<int16_t>(data.PM_AE_UG_10_0)
        };
    }
}

void taskUploadToCloud() {
    const auto current_time = millis();

    if (current_time - last_upload_time >= upload_interval) {
        last_upload_time = current_time;

        if (WiFi.status() == WL_CONNECTED && latest_data.has_value()) {
            Serial.println(F("[Cloud Task] Uploading data to Supabase..."));

            const auto [pm1, pm2_5, pm10] = latest_data.value();

            // 🔥 [Stack Memory Optimization]
            // ประกาศอาร์เรย์ขนาดคงที่ 128 ไบต์บน Stack แทนการใช้คลาส String บน Heap
            char json_payload[128];

            // ใช้ snprintf ในการฟอร์แมตข้อความอย่างปลอดภัยและไม่กินแรม Heap
            snprintf(json_payload, sizeof(json_payload),
                     "{\"pm1\":%d,\"pm2_5\":%d,\"pm10\":%d}",
                     pm1, pm2_5, pm10);

            WiFiClientSecure client;
            client.setInsecure(); // บายพาส SSL เพื่อเลี่ยงการโหลด Cert ก้อนใหญ่เข้า Heap

            HTTPClient http;
            http.begin(client, supabase_url);

            // ส่งค่าด้วย char pointer (const char*) โดยไม่มีการสร้างออบเจกต์ชั่วคราว
            http.addHeader("Content-Type", "application/json");
            http.addHeader("apikey", supabase_anon_key);
            http.addHeader("Authorization", auth_token_buffer); // ดึงค่าจาก Static buffer

            int httpResponseCode = http.POST(reinterpret_cast<uint8_t*>(json_payload), strlen(json_payload));
            Serial.printf("[Cloud Task] Response Code: %d\n", httpResponseCode);

            http.end();
            latest_data = std::nullopt; // ล้างค่าในกล่อง
        }
    }
}

void setup() {
    Serial.begin(9600);
    pmsSerial.begin(9600);

    // เตรียมสร้าง Authorization Header เก็บไว้ครั้งเดียวในขั้นตอน Setup (Static memory)
    snprintf(auth_token_buffer, sizeof(auth_token_buffer), "Bearer %s", supabase_anon_key);

    // ใช้มาโคร F() เพื่อย้ายข้อความดิบไปเก็บไว้ใน Flash Memory (โปรแกรม) ไม่ให้รกแรม
    Serial.print(F("Connecting to WiFi"));
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(F("."));
    }
    Serial.println(F("\nWiFi Connected!"));
}

void loop() {
    taskReadSensor();
    taskUploadToCloud();
}
