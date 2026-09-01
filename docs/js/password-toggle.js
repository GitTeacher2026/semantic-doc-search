/** Toggle visibility for password inputs inside .auth-input-wrap or .password-field-wrap */
export function initPasswordToggles(root = document) {
  root.querySelectorAll(".password-toggle-btn").forEach((button) => {
    if (button.dataset.bound === "1") return;
    button.dataset.bound = "1";

    button.addEventListener("click", () => {
      const wrap = button.closest(".auth-input-wrap, .password-field-wrap");
      const input = wrap?.querySelector('input[type="password"], input[type="text"][data-password-field]');
      if (!input) return;

      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      input.dataset.passwordField = "1";
      button.setAttribute("aria-pressed", showing ? "false" : "true");
      button.setAttribute(
        "aria-label",
        showing ? "إظهار كلمة المرور" : "إخفاء كلمة المرور"
      );
      button.textContent = showing ? "👁" : "🙈";
    });
  });
}

export function passwordFieldMarkup({ id, name, placeholder, autocomplete, required = true }) {
  const req = required ? " required" : "";
  return `
    <div class="auth-input-wrap has-password-toggle">
      <span class="input-icon">🔒</span>
      <input
        id="${id}"
        name="${name}"
        type="password"
        placeholder="${placeholder}"
        autocomplete="${autocomplete}"${req}
      />
      <button type="button" class="password-toggle-btn" aria-label="إظهار كلمة المرور" aria-pressed="false">👁</button>
    </div>`;
}
