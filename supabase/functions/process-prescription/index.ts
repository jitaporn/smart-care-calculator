import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return json({ error: "Unauthorized" }, 401);

    const { file_name, mime_type, file_base64 } = await request.json();
    if (!file_base64 || !mime_type) return json({ error: "Missing document" }, 400);

    const apiKey = Deno.env.get("TYPHOON_API_KEY");
    const apiUrl = Deno.env.get("TYPHOON_API_URL");
    const ocrModel = Deno.env.get("TYPHOON_OCR_MODEL");
    const llmModel = Deno.env.get("TYPHOON_LLM_MODEL");
    if (!apiKey || !apiUrl || !ocrModel || !llmModel) {
      return json({ error: "Typhoon secrets are not configured" }, 500);
    }

    const prompt = `อ่านข้อความใบสั่งยาภาษาไทย/อังกฤษจากภาพนี้อย่างละเอียด
คงข้อความเดิม ตัวเลข หน่วย ตาราง และบรรทัดให้มากที่สุด
ห้ามเดาหรือเติมข้อมูลที่มองไม่เห็น`;

    const ocrResponse = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ocrModel,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime_type};base64,${file_base64}` } },
          ],
        }],
      }),
    });
    if (!ocrResponse.ok) throw new Error(`Typhoon OCR failed: ${ocrResponse.status}`);
    const ocrPayload = await ocrResponse.json();
    const rawText = ocrPayload.choices?.[0]?.message?.content || "";

    const schemaPrompt = `แปลงข้อความใบสั่งยาต่อไปนี้เป็น JSON เท่านั้น
ห้ามคำนวณขนาดยา ห้ามเดาข้อมูลที่ไม่มี ให้ใช้ null
schema:
{"patient_name":string|null,"bed":string|null,"weight_kg":number|null,"age":string|null,
"drug_name":string|null,"dose":number|null,"dose_unit":"mg"|"mcg"|"g"|"unit"|null,
"frequency":string|null,"route":string|null,"stock_drug":number|null,
"stock_unit":"mg"|"mcg"|"g"|"unit"|null,"stock_volume_ml":number|null,
"confidence":number,"uncertain_fields":string[]}

ข้อความ OCR:
${rawText}`;

    const llmResponse = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: llmModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: schemaPrompt }],
      }),
    });
    if (!llmResponse.ok) throw new Error(`Typhoon LLM failed: ${llmResponse.status}`);
    const llmPayload = await llmResponse.json();
    const content = llmPayload.choices?.[0]?.message?.content || "{}";
    const extracted = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));

    const path = `${auth.user.id}/${crypto.randomUUID()}-${file_name || "prescription"}`;
    const bytes = Uint8Array.from(atob(file_base64), c => c.charCodeAt(0));
    await supabase.storage.from("prescriptions").upload(path, bytes, { contentType: mime_type });
    await supabase.from("prescription_scans").insert({
      user_id: auth.user.id,
      storage_path: path,
      raw_ocr_text: rawText,
      extracted_data: extracted,
      confidence: extracted.confidence,
    });

    return json({ raw_text: rawText, ...extracted });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
