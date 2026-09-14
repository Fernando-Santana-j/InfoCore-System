const loginForm = document.getElementById("loginForm");
const togglePasswordBtn = document.getElementById("togglePassword");
const passwordField = document.getElementById("password");
const submitBtn = document.getElementById("loginSubmit");
const emailField = document.getElementById("email");
const rememberField = document.getElementById("remember");
const errorBox = document.getElementById("loginError");

try {
    const savedEmail = localStorage.getItem('infocore:login-email');
    if (savedEmail && emailField) {
        emailField.value = savedEmail;
        if (rememberField) rememberField.checked = true;
        passwordField?.focus();
    }
} catch { /* armazenamento pode estar indisponível */ }

function setLoginError(message = '') {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = !message;
}

if (togglePasswordBtn && passwordField) {
    togglePasswordBtn.addEventListener("click", () => {
        const isHidden = passwordField.type === "password";
        passwordField.type = isHidden ? "text" : "password";
        togglePasswordBtn.textContent = isHidden ? "🙈" : "👁️";
    });
}

if (loginForm && submitBtn) {
    loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        setLoginError();
        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = "Entrando...";

        const formData = new FormData(loginForm);
        const email = (formData.get("email") || "").toString().trim();
        const pass = (formData.get("pass") || "").toString();

        try {
            const response = await fetch("/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, pass })
            });

            const session = await response.json().catch(() => ({}));

            if (!response.ok || session.error) throw new Error(session.message || "Não foi possível realizar o login.");

            try {
                if (rememberField?.checked) localStorage.setItem('infocore:login-email', email);
                else localStorage.removeItem('infocore:login-email');
            } catch { /* armazenamento pode estar indisponível */ }

            window.location.replace("/dashboard");
        } catch (error) {
            setLoginError(error.message || "Erro ao conectar com o servidor. Tente novamente.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
}
