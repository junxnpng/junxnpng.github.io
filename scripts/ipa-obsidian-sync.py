#!/usr/bin/env python3
"""Mirror private Dropbox IPA progress to one Obsidian note on macOS."""
import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = Path.home() / 'Library/Application Support/SayMore'
CONFIG = SUPPORT / 'ipa-obsidian.json'
SERVICE = 'com.saymore.dropbox.ipa'
ACCOUNT = 'ipa-obsidian-sync'
LABEL = 'com.saymore.ipa-obsidian-sync'
START, END = '<!-- saymore:ipa:start -->', '<!-- saymore:ipa:end -->'
REDIRECT = 'http://localhost:18791/callback'


def validate_state(state):
    if not isinstance(state, dict) or state.get('format') != 'saymore-ipa-progress' or state.get('version') != 1 or not isinstance(state.get('items'), dict) or len(state['items']) > 1000:
        raise ValueError('지원하지 않는 IPA 학습 기록입니다. 기존 노트를 유지합니다.')
    clean = {'format': 'saymore-ipa-progress', 'version': 1, 'items': {}}
    for key, item in state['items'].items():
        if not re.fullmatch(r'(ipa-[1-9][0-9]*|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)', key) or not isinstance(item, dict) or type(item.get('mastered')) is not bool:
            raise ValueError('IPA 기록 형식이 올바르지 않습니다.')
        try:
            dt.datetime.fromisoformat(item['updatedAt'].replace('Z', '+00:00'))
        except (KeyError, ValueError, AttributeError):
            raise ValueError('IPA 기록의 변경 시각을 확인해 주세요.')
        if not isinstance(item.get('changeId'), str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', item['changeId']):
            raise ValueError('IPA 기록의 변경 식별자를 확인해 주세요.')
        clean['items'][key] = {field: item[field] for field in ['mastered', 'updatedAt', 'changeId']}
    return clean


def catalog():
    groups = []
    for filename in ['ipa.json', 'ipa_extras.json']:
        data = json.loads((ROOT / 'data/saymore' / filename).read_text())
        for group in data['groups']:
            rows = []
            for item in group['items']:
                key = 'ipa-' + str(item['number']) if 'number' in item else item['id']
                rows.append((key, item.get('display_symbol', item['symbol']), item.get('example', item.get('name'))))
            groups.append((group['title'], rows))
    return groups


def render_note(state, previous=''):
    state = validate_state(state)
    groups = catalog()
    known = [(key, symbol, word) for _, rows in groups for key, symbol, word in rows]
    count = sum(state['items'].get(key, {}).get('mastered', False) for key, _, _ in known)
    lines = [START, '# IPA 학습기록', '', f'**{count} / {len(known)}개 외움**', '',
             '외운 상태는 [Say More IPA](https://junxnpng.github.io/saymore/ipa/)에서 변경합니다.',
             '이 영역은 Dropbox 기록으로 자동 갱신됩니다. 아래 추가 메모는 그대로 유지합니다.', '']
    for title, rows in groups:
        lines.extend(['## ' + title, ''])
        for key, symbol, word in rows:
            checked = 'x' if state['items'].get(key, {}).get('mastered') else ' '
            label = f'{symbol} · {word}'.replace('[', r'\[').replace(']', r'\]')
            lines.append(f'- [{checked}] [{label}](https://junxnpng.github.io/saymore/ipa/#{key})')
        lines.append('')
    # A complete private snapshot survives even if future site versions add IDs.
    lines.extend(['<!-- saymore:ipa:snapshot ' + json.dumps(state, ensure_ascii=False, separators=(',', ':')) + ' -->', END])
    block = '\n'.join(lines)
    if not previous:
        return block + '\n\n## 추가 메모\n\n'
    a, b = previous.find(START), previous.find(END)
    if a < 0 or b < a or previous.count(START) != 1 or previous.count(END) != 1:
        raise ValueError('기존 노트에 자동 갱신 영역이 없어 덮어쓰지 않았습니다.')
    return previous[:a] + block + previous[b + len(END):]


def write_note(path, state):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('기록 노트가 바로가기여서 변경하지 않았습니다.')
    with (path.parent / '.saymore-ipa.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = path.read_text() if path.exists() else ''
        note = render_note(state, previous)
        if note == previous:
            return False
        temp = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.saymore-', delete=False) as handle:
                temp = Path(handle.name)
                handle.write(note)
                handle.flush()
                os.fsync(handle.fileno())
            if (path.read_text() if path.exists() else '') != previous:
                raise ValueError('저장 중 노트가 바뀌어 다음 번에 다시 반영합니다.')
            os.replace(temp, path)
            return True
        finally:
            if temp and temp.exists():
                temp.unlink()


def keychain_read():
    result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], capture_output=True, text=True)
    if result.returncode:
        raise ValueError('맥의 Dropbox 연결이 없습니다. 먼저 연결을 완료해 주세요.')
    return json.loads(result.stdout.strip())


def keychain_write(value):
    payload = json.dumps(value, separators=(',', ':'))
    command = f'add-generic-password -U -s {SERVICE} -a {ACCOUNT} -w {shlex.quote(payload)}\n'
    # Send credentials through stdin; never put them in process arguments or logs.
    subprocess.run(['/usr/bin/security', '-i'], input=command, capture_output=True, text=True, check=True)
    if keychain_read() != value:
        raise ValueError('연결 정보를 맥 키체인에 저장하지 못했습니다.')


def token_request(app_key, fields):
    body = urllib.parse.urlencode({'client_id': app_key, **fields}).encode()
    request = urllib.request.Request('https://api.dropboxapi.com/oauth2/token', data=body, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def authorize(vault):
    vault = Path(vault).expanduser().resolve()
    if not (vault / '.obsidian').is_dir():
        raise ValueError('Obsidian 보관함 폴더를 확인해 주세요.')
    app_key = json.loads((ROOT / 'static/saymore/sync-config.json').read_text())['dropbox_app_key']
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    nonce = secrets.token_urlsafe(32)
    received = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            if parsed.path != '/callback' or not secrets.compare_digest(params.get('state', [''])[0], nonce):
                self.send_error(400)
                return
            received['code'] = params.get('code', [''])[0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.end_headers()
            self.wfile.write('Dropbox 연결 응답을 받았습니다. Say More 채팅으로 돌아오세요.'.encode())

    params = {'client_id': app_key, 'response_type': 'code', 'redirect_uri': REDIRECT, 'token_access_type': 'offline', 'code_challenge_method': 'S256', 'code_challenge': challenge, 'state': nonce, 'scope': 'files.content.read'}
    with http.server.HTTPServer(('127.0.0.1', 18791), Callback) as server:
        server.timeout = 2
        print('연결 주소: https://www.dropbox.com/oauth2/authorize?' + urllib.parse.urlencode(params), flush=True)
        deadline = time.monotonic() + 600
        while 'code' not in received and time.monotonic() < deadline:
            server.handle_request()
    if not received.get('code'):
        raise ValueError('맥의 Dropbox 연결을 완료하지 못했습니다.')
    value = token_request(app_key, {'grant_type': 'authorization_code', 'code': received['code'], 'code_verifier': verifier, 'redirect_uri': REDIRECT})
    if not value.get('refresh_token'):
        raise ValueError('Dropbox의 지속 연결 권한을 받지 못했습니다.')
    keychain_write({'refresh_token': value['refresh_token'], 'access_token': value['access_token'], 'expires_at': time.time() + value['expires_in']})
    SUPPORT.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = {'app_key': app_key, 'note': str(vault / 'SayMore/IPA 학습기록.md')}
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    CONFIG.chmod(0o600)
    print('맥 연결을 완료했습니다. 계정 연결 정보는 키체인에 저장했습니다.', flush=True)


def sync_once():
    config = json.loads(CONFIG.read_text())
    tokens = keychain_read()
    if tokens.get('expires_at', 0) < time.time() + 60:
        value = token_request(config['app_key'], {'grant_type': 'refresh_token', 'refresh_token': tokens['refresh_token']})
        tokens.update(access_token=value['access_token'], expires_at=time.time() + value['expires_in'])
        keychain_write(tokens)
    request = urllib.request.Request('https://content.dropboxapi.com/2/files/download', data=b'', headers={'Authorization': 'Bearer ' + tokens['access_token'], 'Dropbox-API-Arg': '{"path":"/ipa-progress.json"}'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read(1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        if error.code == 409:
            value = json.loads(error.read())
            if value.get('error', {}).get('path', {}).get('.tag') == 'not_found':
                print('웹의 IPA 기록이 만들어지면 Obsidian에 반영합니다.')
                return
        raise ValueError('Dropbox 기록을 읽지 못했습니다. 기존 노트는 유지합니다.')
    if len(raw) > 1024 * 1024:
        raise ValueError('기록 파일이 너무 커서 기존 노트를 유지합니다.')
    changed = write_note(Path(config['note']), validate_state(json.loads(raw)))
    print('Obsidian 기록 반영 완료' if changed else '기록 변경 없음')


def install():
    if not CONFIG.exists():
        raise ValueError('맥의 Dropbox 연결을 먼저 완료해 주세요.')
    path = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    logs = Path.home() / 'Library/Logs/SayMore'
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise ValueError('이미 자동 반영 설정이 있습니다. 기존 설정을 먼저 확인해 주세요.')
    value = {'Label': LABEL, 'ProgramArguments': [sys.executable, str(Path(__file__).resolve()), '--sync'], 'StartInterval': 60, 'RunAtLoad': True, 'StandardOutPath': str(logs / 'ipa-sync.log'), 'StandardErrorPath': str(logs / 'ipa-sync-error.log')}
    path.write_bytes(plistlib.dumps(value))
    subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True, capture_output=True)
    print('맥 로그인 후 1분마다 Obsidian에 자동 반영합니다.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--authorize', metavar='VAULT')
    mode.add_argument('--sync', action='store_true')
    mode.add_argument('--install', action='store_true')
    args = parser.parse_args()
    try:
        if args.authorize:
            authorize(args.authorize)
        elif args.install:
            install()
        else:
            sync_once()
    except Exception as error:
        # OAuth responses and keychain output must never reach persistent logs.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('자동 반영하지 못했습니다: ' + message, file=sys.stderr)
        sys.exit(1)
