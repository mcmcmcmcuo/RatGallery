# -*- coding: utf-8 -*-
"""老鼠图片库 - 本地小助手
双击运行，浏览器打开 http://localhost:8000
用完按 Ctrl+C 或直接关窗口
可选：pip install Pillow （装了才能读照片的拍摄时间）
"""
import json
import os
import mimetypes
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler

try:
    from PIL import Image
    from PIL.ExifTags import TAGS
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

IMG_DIR = "images"
DATA_FILE = "data.json"
PORT = 8000

IMG_EXTS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.jfif', '.avif')
VIDEO_EXTS = ('.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v')


def is_image(n):
    return n.lower().endswith(IMG_EXTS)


def is_video(n):
    return n.lower().endswith(VIDEO_EXTS)


def load_data():
    if os.path.isfile(DATA_FILE):
        try:
            with open(DATA_FILE, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_data(d):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)


def scan_files():
    if not os.path.isdir(IMG_DIR):
        return []
    return sorted(f for f in os.listdir(IMG_DIR)
                  if os.path.isfile(os.path.join(IMG_DIR, f))
                  and (is_image(f) or is_video(f)))


def read_exif_time(path):
    """从照片的 EXIF 里读拍摄时间"""
    if not HAS_PIL:
        return None
    try:
        img = Image.open(path)
        exif = img.getexif()
        if not exif:
            return None
        for k, v in exif.items():
            if TAGS.get(k) == 'DateTimeOriginal':
                try:
                    dt = datetime.strptime(v, '%Y:%m:%d %H:%M:%S')
                    return dt.timestamp()
                except Exception:
                    pass
    except Exception:
        pass
    return None


def get_meta(name, data):
    p = os.path.join(IMG_DIR, name)
    try:
        st = os.stat(p)
    except OSError:
        return None

    saved = data.get(name, {})

    # 时间优先级：用户手动存的 > EXIF 拍摄时间 > 文件修改时间 > 文件创建时间
    if 'time' in saved:
        t = saved['time']
    else:
        t = read_exif_time(p) if is_image(name) else None
        if t is None:
            t = st.st_mtime
        if t is None or t <= 0:
            t = st.st_ctime

    return {
        'name': name,
        'type': 'video' if is_video(name) else 'image',
        'size': st.st_size,
        'time': t,
        'tags': saved.get('tags', []),
        'note': saved.get('note', ''),
    }


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # 列表
        if self.path == '/api/list':
            data = load_data()
            items = [get_meta(f, data) for f in scan_files()]
            self._json({
                'items': [m for m in items if m],
                'tree': data.get('_tree', ''),
            })
            return

        # 图片 / 视频
        if self.path.startswith('/images/'):
            name = os.path.basename(self.path[len('/images/'):])
            p = os.path.join(IMG_DIR, name)
            if not os.path.isfile(p):
                self.send_error(404)
                return

            ctype, _ = mimetypes.guess_type(p)
            ctype = ctype or 'application/octet-stream'
            size = os.path.getsize(p)

            range_header = self.headers.get('Range', '')
            if range_header.startswith('bytes='):
                # 视频拖动进度条要靠 206 分块响应
                r = range_header[6:].split(',')[0]
                start_s, _, end_s = r.partition('-')
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else size - 1
                end = min(end, size - 1)
                length = end - start + 1
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(length))
                self.end_headers()
                with open(p, 'rb') as f:
                    f.seek(start)
                    self.wfile.write(f.read(length))
            else:
                self.send_response(200)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(size))
                self.end_headers()
                with open(p, 'rb') as f:
                    self.wfile.write(f.read())
            return

        # 其余交给默认处理器，会自动伺服 index.html / style.css / app.js
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/update':
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            name = payload.get('name')
            if not name or os.path.basename(name) != name:
                self._json({'error': 'bad name'}, 400)
                return
            data = load_data()
            entry = data.setdefault(name, {})
            if 'tags' in payload:
                entry['tags'] = [t for t in payload['tags'] if t]
            if 'note' in payload:
                entry['note'] = payload['note']
            if 'time' in payload:
                entry['time'] = float(payload['time'])
            save_data(data)
            self._json({'ok': True})

        elif self.path == '/api/tree':
            length = int(self.headers.get('Content-Length', 0))
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            data = load_data()
            data['_tree'] = payload.get('tree', '')
            save_data(data)
            self._json({'ok': True})

        else:
            self.send_error(404)


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    if not HAS_PIL:
        print("提示：未安装 Pillow，无法读取照片拍摄时间。")
        print("安装方法：pip install Pillow")
    print(f"启动成功，浏览器打开：http://localhost:{PORT}")
    print("按 Ctrl+C 停止")
    httpd = HTTPServer(('127.0.0.1', PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == '__main__':
    main()
