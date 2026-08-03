#!/bin/bash
# ponytail: throwaway sketch generator for this design-exploration session only.
# Not part of the app; calls Vertex AI gemini-3-pro-image (Nano Banana Pro) directly
# since the impeccable skill's generate-image.mjs only supports OpenAI.
set -euo pipefail
PROMPT_FILE="$1"
OUT_PNG="$2"
PROJECT="propane-galaxy-498403-n8"

TOKEN=$(gcloud auth print-access-token)
PROMPT_TEXT=$(cat "$PROMPT_FILE")

python3 - "$PROMPT_TEXT" "$TOKEN" "$PROJECT" "$OUT_PNG" <<'PYEOF'
import sys, json, base64, urllib.request

prompt, token, project, out_png = sys.argv[1:5]
url = f"https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/gemini-3-pro-image:generateContent"
body = json.dumps({
    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "16:9"}}
}).encode()
req = urllib.request.Request(url, data=body, headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
})
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)
parts = data["candidates"][0]["content"]["parts"]
img_part = next(p for p in parts if "inlineData" in p)
with open(out_png, "wb") as f:
    f.write(base64.b64decode(img_part["inlineData"]["data"]))
print(f"wrote {out_png}")
PYEOF
