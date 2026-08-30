"""Simple session login gate for the Streamlit app."""

from __future__ import annotations

import hashlib
import os

import streamlit as st

DEFAULT_USERNAME = os.getenv("DOCSHELF_USERNAME", "admin")
DEFAULT_PASSWORD = os.getenv("DOCSHELF_PASSWORD", "9gYeYhcVN62es7w")


def _password_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _expected_hash() -> str:
    configured = os.getenv("DOCSHELF_PASSWORD_HASH")
    if configured:
        return configured.strip()
    return _password_hash(DEFAULT_PASSWORD)


def is_authenticated() -> bool:
    return bool(st.session_state.get("authenticated"))


def login(username: str, password: str) -> bool:
    if username.strip() == DEFAULT_USERNAME and _password_hash(password) == _expected_hash():
        st.session_state.authenticated = True
        st.session_state.username = username.strip()
        return True
    return False


def logout() -> None:
    st.session_state.authenticated = False
    st.session_state.pop("username", None)


def render_login_page() -> None:
    """Show the Arabic login screen and stop the app until authenticated."""
    st.markdown(
        """
        <div class="login-shell">
          <div class="login-card">
            <p class="login-brand">مخزن الوثائق</p>
            <p class="login-sub">سجّل الدخول للوصول إلى رفع الملفات والبحث الدلالي</p>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    _left, center, _right = st.columns([1, 1.1, 1])
    with center:
        with st.form("login_form", clear_on_submit=False):
            st.markdown("#### تسجيل الدخول")
            username = st.text_input("اسم المستخدم", placeholder="admin")
            password = st.text_input("كلمة المرور", type="password", placeholder="••••••••")
            submitted = st.form_submit_button("دخول", type="primary", use_container_width=True)

        if submitted:
            if login(username, password):
                st.rerun()
            st.error("اسم المستخدم أو كلمة المرور غير صحيحة.")


def require_login() -> None:
    if not is_authenticated():
        render_login_page()
        st.stop()
