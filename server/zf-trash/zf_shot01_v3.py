import json, urllib.request, time, sys, shutil, os

HOST = "http://127.0.0.1:8188"
REF = "黑玫瑰_单人正面_参考图.png"

PROMPT = (
    "Transform this woman into a cinematic shot: late night dark office, "
    "she sits slumped at her workstation, exhausted, one hand on her forehead, "
    "multiple computer monitors glowing cold blue light and red error screens, "
    "shallow depth of field, 35mm film, low-key cinematic lighting, "
    "keep her exact face, hairstyle and outfit unchanged, single person only, "
    "photorealistic, 16:9 widescreen"
)

NEG = "two people, multiple people, crowd, duplicate character, extra person, clone, mirror copy"

wf = {
    "1": {"class_type": "LoadImage", "inputs": {"image": REF, "upload": "image"}},
    "2": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_edit_2511_bf16.safetensors", "weight_dtype": "default"}},
    "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
    "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image"}},
    "5": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["2", 0], "lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1.0}},
    "6": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["4", 0], "image1": ["1", 0], "prompt": PROMPT, "vae": ["3", 0]}},
    "7": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": {"clip": ["4", 0], "image1": ["1", 0], "prompt": NEG, "vae": ["3", 0]}},
    "8": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1920, "height": 1080, "batch_size": 1}},
    "9": {"class_type": "KSampler", "inputs": {
        "model": ["5", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["8", 0],
        "seed": 7301, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
    "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
    "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": "heimeigui_shot01_v3"}},
}

req = urllib.request.Request(HOST + "/prompt", json.dumps({"prompt": wf}).encode(), {"Content-Type": "application/json"})
try:
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    print("ERROR_BODY:", e.read().decode("utf-8", "ignore"))
    sys.exit(1)
pid = resp["prompt_id"]
print("queued", pid)

for i in range(150):
    time.sleep(2)
    h = json.loads(urllib.request.urlopen(f"{HOST}/history/{pid}", timeout=15).read())
    if pid in h:
        outs = h[pid]["outputs"]
        for node, o in outs.items():
            for img in o.get("images", []):
                fn = img["filename"]
                src = os.path.join(r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output", fn)
                dst = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\宣传片\镜头01_黑玫瑰登场_首帧_1920_v3.png"
                shutil.copy2(src, dst)
                from PIL import Image
                im = Image.open(dst)
                print("DONE", dst, im.size, os.path.getsize(dst))
                sys.exit(0)
print("TIMEOUT")
sys.exit(1)
