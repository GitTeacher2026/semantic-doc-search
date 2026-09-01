function canUsePasswordCredential() {
  return typeof window.PasswordCredential === "function" && typeof navigator.credentials?.store === "function";
}

async function storeWithCredentialApi(username, password) {
  const credential = new PasswordCredential({
    id: username,
    password,
    name: username,
  });
  await navigator.credentials.store(credential);
}

function submitCredentialsToHiddenFrame(username, password) {
  const catcher = document.getElementById("credential-catcher");
  if (!catcher) return;

  const helper = document.createElement("form");
  helper.method = "post";
  helper.action = "about:blank";
  helper.target = "credential-catcher";
  helper.style.display = "none";

  const usernameInput = document.createElement("input");
  usernameInput.name = "username";
  usernameInput.autocomplete = "username";
  usernameInput.value = username;

  const passwordInput = document.createElement("input");
  passwordInput.name = "password";
  passwordInput.type = "password";
  passwordInput.autocomplete = "current-password";
  passwordInput.value = password;

  helper.append(usernameInput, passwordInput);
  document.body.appendChild(helper);
  HTMLFormElement.prototype.submit.call(helper);
  helper.remove();
}

/**
 * Ask the browser to offer saving login credentials after a successful SPA auth.
 */
export async function promptSavePassword({ username, password }) {
  const id = String(username || "").trim();
  const secret = String(password || "");
  if (!id || !secret) return;

  if (canUsePasswordCredential()) {
    try {
      await storeWithCredentialApi(id, secret);
      return;
    } catch {
      // Fall through to the iframe technique for browsers that block store().
    }
  }

  submitCredentialsToHiddenFrame(id, secret);
}
