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
        let session = await fetch()
    });
}
