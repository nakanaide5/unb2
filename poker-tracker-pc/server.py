#!/usr/bin/env python3
"""
Покерный трекер — локальный сервер.
Показывает программу в браузере и хранит все данные в файле data/poker.db рядом с собой.
Нужен только Python 3 (без дополнительных библиотек).
"""
import datetime
import json
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

APP_ID = 'poker-tracker-pc'
APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get('POKER_TRACKER_DATA') or (APP_DIR / 'data')).resolve()
DB_PATH = DATA_DIR / 'poker.db'
BACKUP_DIR = DATA_DIR / 'backups'
KEEP_BACKUPS = 14
HOST = '127.0.0.1'
_PORT0 = int(os.environ.get('POKER_TRACKER_PORT') or 8765)
PORTS = range(_PORT0, _PORT0 + 15)
TABLES = ('sessions', 'hands', 'raw', 'meta')
STATIC = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/parser.js': 'parser.js'}
CTYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8'}


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=NORMAL')
        for t in TABLES:
            self.db.execute(f'CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
        self.db.commit()

    def all(self, t):
        with self.lock:
            rows = self.db.execute(f'SELECT data FROM {t}').fetchall()
        return '[' + ','.join(r[0] for r in rows) + ']'

    def get(self, t, key):
        with self.lock:
            row = self.db.execute(f'SELECT data FROM {t} WHERE id=?', (key,)).fetchone()
        return row[0] if row else 'null'

    def put(self, t, key, data_json):
        json.loads(data_json)  # проверка, что это корректный JSON
        with self.lock:
            self.db.execute(f'INSERT OR REPLACE INTO {t} (id, data) VALUES (?, ?)', (key, data_json))
            self.db.commit()

    def put_many(self, t, items):
        rows = []
        for it in items:
            if not isinstance(it, dict) or not isinstance(it.get('id'), str):
                raise ValueError('у каждой записи должно быть поле id')
            rows.append((it['id'], json.dumps(it, ensure_ascii=False, separators=(',', ':'))))
        with self.lock:
            self.db.executemany(f'INSERT OR REPLACE INTO {t} (id, data) VALUES (?, ?)', rows)
            self.db.commit()
        return len(rows)

    def delete(self, t, key):
        with self.lock:
            self.db.execute(f'DELETE FROM {t} WHERE id=?', (key,))
            self.db.commit()

    def clear(self, t):
        with self.lock:
            self.db.execute(f'DELETE FROM {t}')
            self.db.commit()

    def counts(self):
        with self.lock:
            return {t: self.db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('sessions', 'hands')}

    def backup(self):
        """Одна копия в день, хранятся последние KEEP_BACKUPS."""
        c = self.counts()
        if not c['sessions'] and not c['hands']:
            return None
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        target = BACKUP_DIR / f'poker-{datetime.date.today().isoformat()}.db'
        if not target.exists():
            dst = sqlite3.connect(str(target))
            with self.lock:
                self.db.backup(dst)
            dst.close()
        old = sorted(BACKUP_DIR.glob('poker-*.db'))[:-KEEP_BACKUPS]
        for f in old:
            try:
                f.unlink()
            except OSError:
                pass
        return target


store: Store = None  # создаётся в main()


def open_folder(path: Path):
    if sys.platform.startswith('win'):
        os.startfile(str(path))  # noqa: S606 — открываем свою папку данных
    elif sys.platform == 'darwin':
        subprocess.Popen(['open', str(path)])
    else:
        subprocess.Popen(['xdg-open', str(path)])


class Server(ThreadingHTTPServer):
    """Порт только наш: в Windows без этого можно «сесть» на порт, который уже слушает другая программа,
    и браузер откроет её страницу вместо трекера."""
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, port)) == 0


class Handler(BaseHTTPRequestHandler):
    server_version = 'PokerTracker'

    def log_message(self, *args):
        pass

    # --- служебное ---
    def _host_ok(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0]
        return host in ('127.0.0.1', 'localhost')

    def _api_ok(self):
        # свой заголовок не может отправить чужой сайт без разрешения — защита от запросов со сторонних страниц
        return self._host_ok() and self.headers.get('X-Tracker') == '1'

    def _send(self, code, body='', ctype='application/json; charset=utf-8'):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, json.dumps({'error': msg}, ensure_ascii=False))

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n).decode('utf-8') if n else ''

    def _parts(self):
        return [unquote(p) for p in self.path.split('?')[0].split('/') if p]

    def _store_route(self):
        p = self._parts()
        if len(p) >= 3 and p[0] == 'api' and p[1] == 'store' and p[2] in TABLES and len(p) <= 4:
            return p[2], (p[3] if len(p) == 4 else None)
        return None, None

    def _handle(self, method):
        if not self._host_ok():
            return self._err(403, 'доступ только с этого компьютера')
        path = self.path.split('?')[0]
        if method == 'GET' and path == '/api/ping':
            return self._send(200, json.dumps({'app': APP_ID}))
        if not path.startswith('/api/'):
            if method != 'GET' or path not in STATIC:
                return self._err(404, 'нет такой страницы')
            f = APP_DIR / STATIC[path]
            return self._send(200, f.read_bytes(), CTYPES[f.suffix])
        if not self._api_ok():
            return self._err(403, 'запрос отклонён')
        try:
            if path == '/api/info' and method == 'GET':
                size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
                backups = sorted(BACKUP_DIR.glob('poker-*.db')) if BACKUP_DIR.exists() else []
                return self._send(200, json.dumps({
                    'dataDir': str(DATA_DIR), 'dbPath': str(DB_PATH), 'size': size,
                    'backups': len(backups), 'lastBackup': backups[-1].stem[6:] if backups else None,
                }, ensure_ascii=False))
            if path == '/api/open-folder' and method == 'POST':
                open_folder(DATA_DIR)
                return self._send(200, '{"ok":true}')
            if path == '/api/backup' and method == 'POST':
                t = store.backup()
                return self._send(200, json.dumps({'file': str(t) if t else None}, ensure_ascii=False))
            t, key = self._store_route()
            if not t:
                return self._err(404, 'нет такого адреса')
            if method == 'GET':
                return self._send(200, store.get(t, key) if key is not None else store.all(t))
            if method == 'PUT' and key is not None:
                store.put(t, key, self._body())
                return self._send(200, '{"ok":true}')
            if method == 'POST' and key is None:
                n = store.put_many(t, json.loads(self._body() or '[]'))
                return self._send(200, json.dumps({'ok': True, 'saved': n}))
            if method == 'DELETE':
                store.delete(t, key) if key is not None else store.clear(t)
                return self._send(200, '{"ok":true}')
            return self._err(405, 'метод не поддерживается')
        except (ValueError, json.JSONDecodeError) as e:
            return self._err(400, str(e))
        except Exception as e:  # noqa: BLE001
            return self._err(500, f'{type(e).__name__}: {e}')

    def do_GET(self):
        self._handle('GET')

    def do_PUT(self):
        self._handle('PUT')

    def do_POST(self):
        self._handle('POST')

    def do_DELETE(self):
        self._handle('DELETE')


def already_running(port):
    try:
        with urllib.request.urlopen(f'http://{HOST}:{port}/api/ping', timeout=0.7) as r:
            return json.loads(r.read().decode('utf-8')).get('app') == APP_ID
    except Exception:  # noqa: BLE001
        return False


def main():
    global store
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='replace')
        except Exception:  # noqa: BLE001
            pass
    no_browser = os.environ.get('POKER_TRACKER_NO_BROWSER') == '1'
    httpd = None
    for port in PORTS:
        if already_running(port):
            url = f'http://{HOST}:{port}/'
            print(f'Трекер уже запущен: {url} — открываю его в браузере.')
            if not no_browser:
                webbrowser.open(url)
            return
        if port_busy(port):
            print(f'Порт {port} занят другой программой — пробую следующий.')
            continue
        try:
            httpd = Server((HOST, port), Handler)
            break
        except OSError:
            continue
    if httpd is None:
        print(f'Не нашёл свободный порт ({PORTS.start}–{PORTS.stop - 1}). Закройте лишние программы и попробуйте снова.')
        sys.exit(1)

    store = Store(DB_PATH)
    try:
        store.backup()
    except Exception as e:  # noqa: BLE001
        print(f'Не удалось сделать резервную копию: {e}')

    url = f'http://{HOST}:{httpd.server_address[1]}/'
    print('Покерный трекер запущен')
    print(f'  Адрес:  {url}')
    print(f'  Данные: {DB_PATH}')
    print('  Не закрывайте это окно, пока пользуетесь трекером. Чтобы выйти — просто закройте его.')
    if not no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        store.db.close()


if __name__ == '__main__':
    main()
