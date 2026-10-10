# -*- coding: utf-8 -*-
import os
import json

IMG_DIR = "images"
TAG_FILE = "tags.txt"
TREE_FILE = "tagtree.txt"
OUT_FILE = "index.html"

IMG_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".jfif", ".avif")
VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")

TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>老鼠图片</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; margin: 0; }
header { position: sticky; top: 0; background: #fff;
         border-bottom: 1px solid #ccc; padding: 10px 14px; z-index: 10; }
h1 { margin: 0 0 8px; font-size: 16px; }
input[type=search] { width: 100%; padding: 6px; border: 1px solid #999;
                     font-size: 14px; box-sizing: border-box; }
.tags { margin-top: 8px; }
.tagbtn { padding: 2px 8px; margin: 2px; border: 1px solid #999;
          background: #fff; cursor: pointer; font-size: 12px; }
.tagbtn.on { background: #333; color: #fff; }
#count { color: #666; font-size: 12px; margin-top: 6px; }
#grid { padding: 14px; display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px; }
.card { border: 1px solid #ddd; padding: 6px; }
.card img, .card video { width: 100%; aspect-ratio: 1/1; object-fit: cover;
                         display: block; cursor: zoom-in; background: #000; }
.card .nm { font-size: 11px; color: #666; word-break: break-all; margin-top: 4px; }
.card .tg { margin-top: 2px; }
.tag { display: inline-block; background: #eee; padding: 0 6px;
       margin: 2px 2px 0 0; font-size: 11px; cursor: pointer; }
.tag:hover { background: #ddd; }
.card .note { font-size: 11px; color: #888; margin-top: 2px; }
#pager { text-align: center; padding: 10px; }
#pager button { margin: 0 2px; padding: 4px 10px; }
#pager .cur { font-weight: bold; background: #ddd; }
#lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.85);
            z-index: 100; cursor: zoom-out;
            align-items: center; justify-content: center; }
#lightbox.on { display: flex; }
#lightbox img, #lightbox video { max-width: 95vw; max-height: 95vh; }
</style>
</head>
<body>
<header>
  <h1>老鼠图片</h1>
  <input type="search" id="q" placeholder="搜索文件名 / 标签 / 备注（空格分隔多个关键词）">
  <div class="tags" id="tagbar"></div>
  <div id="count"></div>
</header>
<div id="grid"></div>
<div id="pager"></div>
<div id="lightbox"></div>
<script>
const DATA = __DATA__;
const PER_PAGE = 40;
const state = { q: "", tags: new Set(), page: 1 };
const $ = s => document.querySelector(s);

function filtered() {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sel = [...state.tags];
  return DATA.images.filter(im => {
    if (sel.length && !sel.every(t => im.all.includes(t))) return false;
    if (!words.length) return true;
    const hay = (im.file + " " + im.all.join(" ") + " " + im.note).toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

function renderTagBar() {
  const bar = $("#tagbar");
  bar.innerHTML = "";
  for (const t of DATA.tags) {
    const b = document.createElement("button");
    b.className = "tagbtn" + (state.tags.has(t.name) ? " on" : "");
    b.textContent = t.name + " " + t.count;
    b.onclick = () => {
      state.tags.has(t.name) ? state.tags.delete(t.name) : state.tags.add(t.name);
      state.page = 1;
      render();
    };
    bar.appendChild(b);
  }
}

function openLightbox(src, type) {
  const box = $("#lightbox");
  box.innerHTML = "";
  let el;
  if (type === "video") {
    el = document.createElement("video");
    el.src = src;
    el.controls = true;
    el.autoplay = true;
  } else {
    el = document.createElement("img");
    el.src = src;
  }
  box.appendChild(el);
  box.classList.add("on");
}

function closeLightbox() {
  const box = $("#lightbox");
  box.innerHTML = "";
  box.classList.remove("on");
}

function renderGrid(list) {
  const grid = $("#grid");
  grid.innerHTML = "";
  const start = (state.page - 1) * PER_PAGE;
  const chunk = list.slice(start, start + PER_PAGE);
  if (!chunk.length) {
    grid.innerHTML = "<p style='grid-column:1/-1;color:#888'>没有匹配的图片</p>";
    return;
  }
  for (const im of chunk) {
    const card = document.createElement("div");
    card.className = "card";

    const src = DATA.imgDir + "/" + im.file;

    if (im.type === "video") {
      const v = document.createElement("video");
      v.src = src;
      v.preload = "metadata";
      v.muted = true;
      v.onclick = () => openLightbox(src, "video");
      card.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = src;
      img.alt = im.file;
      img.onclick = () => openLightbox(src, "image");
      card.appendChild(img);
    }

    const nm = document.createElement("div");
    nm.className = "nm";
    nm.textContent = im.file;
    card.appendChild(nm);

    if (im.all.length) {
      const tg = document.createElement("div");
      tg.className = "tg";
      for (const t of im.all) {
        const s = document.createElement("span");
        s.className = "tag";
        s.textContent = t;
        s.title = "点一下加入筛选";
        s.onclick = () => {
          state.tags.add(t);
          state.page = 1;
          render();
        };
        tg.appendChild(s);
      }
      card.appendChild(tg);
    }

    if (im.note) {
      const n = document.createElement("div");
      n.className = "note";
      n.textContent = im.note;
      card.appendChild(n);
    }

    grid.appendChild(card);
  }
}

function renderPager(total) {
  const pager = $("#pager");
  pager.innerHTML = "";
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (state.page > pages) state.page = pages;

  const mk = (label, target, disabled) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = !!disabled;
    if (target === state.page) b.className = "cur";
    else if (!disabled) b.onclick = () => {
      state.page = target;
      render();
      window.scrollTo(0, 0);
    };
    return b;
  };

  pager.appendChild(mk("← 上一页", state.page - 1, state.page === 1));
  for (let i = 1; i <= pages; i++) pager.appendChild(mk(String(i), i, false));
  pager.appendChild(mk("下一页 →", state.page + 1, state.page === pages));
}

function render() {
  const list = filtered();
  $("#count").textContent = list.length + " / " + DATA.images.length + " 张";
  renderGrid(list);
  renderPager(list.length);
}

$("#q").addEventListener("input", e => {
  state.q = e.target.value;
  state.page = 1;
  render();
});

$("#lightbox").addEventListener("click", e => {
  if (e.target.id === "lightbox") closeLightbox();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeLightbox();
});

renderTagBar();
render();
</script>
</body>
</html>
"""


def load_tree():
    parent = {}
    if not os.path.isfile(TREE_FILE):
        return parent
    with open(TREE_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("/") if p.strip()]
            for i in range(1, len(parts)):
                parent[parts[i]] = parts[i - 1]
    return parent


def expand(tags, parent):
    out = set()
    for t in tags:
        out.add(t)
        cur = t
        while cur in parent and parent[cur] not in out:
            cur = parent[cur]
            out.add(cur)
    return out


def load_tags():
    result = {}
    if not os.path.isfile(TAG_FILE):
        return result
    with open(TAG_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            fname = parts[0]
            tags = [t.strip() for t in parts[1].split(",") if t.strip()] if len(parts) > 1 else []
            note = parts[2] if len(parts) > 2 else ""
            if fname:
                result[fname] = (tags, note)
    return result


def build():
    if not os.path.isdir(IMG_DIR):
        print(f"找不到 {IMG_DIR} 文件夹")
        return

    all_files = os.listdir(IMG_DIR)
    files = []
    for f in all_files:
        low = f.lower()
        if low.endswith(IMG_EXTS):
            files.append((f, "image"))
        elif low.endswith(VIDEO_EXTS):
            files.append((f, "video"))
    files.sort(key=lambda x: x[0].lower())

    if not files:
        print(f"{IMG_DIR} 里没有图片或视频")
        return

    tags_map = load_tags()
    parent = load_tree()

    images_data = []
    for f, typ in files:
        own, note = tags_map.get(f, ([], ""))
        all_tags = sorted(expand(own, parent))
        images_data.append({
            "file": f,
            "type": typ,
            "own": own,
            "all": all_tags,
            "note": note,
        })

    tag_counts = {}
    for im in images_data:
        for t in im["all"]:
            tag_counts[t] = tag_counts.get(t, 0) + 1
    tags_list = [{"name": k, "count": tag_counts[k]} for k in sorted(tag_counts)]

    data = {"images": images_data, "tags": tags_list, "imgDir": IMG_DIR}
    data_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

    doc = TEMPLATE.replace("__DATA__", data_json)
    with open(OUT_FILE, "w", encoding="utf-8") as fp:
        fp.write(doc)

    n_img = sum(1 for _, t in files if t == "image")
    n_vid = sum(1 for _, t in files if t == "video")
    print(f"已生成 {OUT_FILE}：{n_img} 张图，{n_vid} 个视频，{len(tags_list)} 个标签")


if __name__ == "__main__":
    build()