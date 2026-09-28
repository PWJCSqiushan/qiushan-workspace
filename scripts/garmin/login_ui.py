"""Local-only Garmin China sign-in. Credentials never enter the website or logs."""
import argparse
import queue
import threading
import tkinter as tk
from tkinter import ttk
from pathlib import Path
from sync import ROOT, authenticate, load


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default=str(ROOT / 'config.json'))
    args = parser.parse_args()
    config = load(Path(args.config), {})
    window = tk.Tk()
    window.title('丘山流调 · Garmin 中国区登录')
    window.geometry('480x390')
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=26)
    frame.pack(fill='both', expand=True)
    ttk.Label(frame, text='连接 Garmin 中国区', font=('Microsoft YaHei UI', 18, 'bold')).pack(anchor='w')
    ttk.Label(frame, text='账号、密码和验证码仅在本机输入；保存登录会话后自动同步。', wraplength=425).pack(anchor='w', pady=(8, 18))
    ttk.Label(frame, text='账号').pack(anchor='w')
    username = ttk.Entry(frame, width=48)
    username.pack(fill='x', pady=(4, 10))
    ttk.Label(frame, text='密码').pack(anchor='w')
    password = ttk.Entry(frame, show='●', width=48)
    password.pack(fill='x', pady=(4, 12))
    message = tk.StringVar(value='首次登录或会话失效时需要验证。')
    ttk.Label(frame, textvariable=message, wraplength=425).pack(anchor='w', pady=8)
    messages = queue.Queue()
    mfa_ready = threading.Event()
    mfa_value = ['']
    closed = threading.Event()
    active = [False]

    def prompt_mfa():
        mfa_ready.clear()
        messages.put(('mfa', None))
        while not mfa_ready.wait(.2):
            if closed.is_set():
                raise RuntimeError('login_cancelled')
        if not mfa_value[0]:
            raise RuntimeError('login_cancelled')
        return mfa_value.pop()

    def worker(user, secret):
        try:
            authenticate(config, user, secret, prompt_mfa)
            messages.put(('success', None))
        except Exception as exc:
            code = str(exc)
            messages.put(('error', {
                'reauth_required': '账号、密码或验证码未通过，请检查后重试。',
                'garmin_rate_limited': 'Garmin 暂时限制登录频率，请稍后再试。',
                'auth_in_progress': '同步器正在更新会话，请稍后重试。',
                'token_store_unavailable': '本机无法保存登录会话，请检查目录权限。',
            }.get(code, '暂时无法连接 Garmin，请稍后重试。')))
        finally:
            secret = None

    def start():
        if active[0]:
            return
        user, secret = username.get().strip(), password.get()
        if not user or not secret:
            message.set('请填写账号和密码。')
            return
        password.delete(0, 'end')
        active[0] = True
        button.configure(state='disabled')
        message.set('正在登录；如需验证码，会在这里提示。')
        threading.Thread(target=worker, args=(user, secret), daemon=True).start()

    button = ttk.Button(frame, text='登录并保存会话', command=start)
    button.pack(fill='x', pady=8)

    def poll():
        try:
            while True:
                kind, value = messages.get_nowait()
                if kind == 'mfa':
                    dialog = tk.Toplevel(window)
                    dialog.title('Garmin 验证码')
                    dialog.geometry('380x160')
                    dialog.transient(window)
                    dialog.grab_set()
                    ttk.Label(dialog, text='请输入 Garmin 发送给你的验证码：').pack(pady=(20, 8))
                    code = ttk.Entry(dialog)
                    code.pack(fill='x', padx=24)
                    def finish():
                        mfa_value[:] = [code.get().strip()]
                        mfa_ready.set()
                        dialog.destroy()
                    ttk.Button(dialog, text='继续验证', command=finish).pack(pady=12)
                    code.focus_set()
                    dialog.protocol('WM_DELETE_WINDOW', lambda: (mfa_value.clear(), mfa_value.append(''), mfa_ready.set(), dialog.destroy()))
                elif kind == 'success':
                    message.set('登录成功，会话已保存。后台同步器将继续同步，可关闭此窗口。')
                    button.configure(text='关闭', state='normal', command=window.destroy)
                elif kind == 'error':
                    active[0] = False
                    button.configure(state='normal')
                    message.set(value)
                    password.focus_set()
        except queue.Empty:
            pass
        if not closed.is_set():
            window.after(100, poll)

    def close():
        closed.set()
        window.destroy()
    window.protocol('WM_DELETE_WINDOW', close)
    password.bind('<Return>', lambda _: start())
    username.focus_set()
    poll()
    window.mainloop()
    closed.set()


if __name__ == '__main__':
    main()
