const loginForm = document.getElementById("loginForm");
const togglePasswordBtn = document.getElementById("togglePassword");
const passwordField = document.getElementById("password");
const submitBtn = document.getElementById("loginSubmit");

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

            const session = await response.json();

            if (session.error) {
                alert(session.message || "Nao foi possivel realizar o login.");
                return;
            }

            window.location.href = "/dashboard";
        } catch (error) {
            alert("Erro ao conectar com o servidor. Tente novamente.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
}
