import os
EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
files = os.listdir("images")
kept = [f for f in files if f.lower().endswith(EXTS)]
skipped = [f for f in files if f not in kept]

print(f"总共 {len(files)} 个文件")
print(f"收进去 {len(kept)} 个")
print(f"跳过 {len(skipped)} 个：")
for f in skipped:
    print("  ", f)