(() => {
  const databaseLinks = [...document.querySelectorAll('a[href="basededatos.html"]')];
  databaseLinks.forEach(link => { const item=link.closest('li'); if(item)item.hidden=true; });
  const userLabel = document.getElementById('session-user');
  const loginLink = document.getElementById('session-login');
  const registerLink = document.getElementById('session-register');
  const adminLink = document.getElementById('session-admin');
  const staffLink = document.getElementById('session-staff');
  const logoutButton = document.getElementById('session-logout');

  fetch('/api/sesion', { credentials: 'include' })
    .then(response => response.json())
    .then(({ user }) => {
      if (user?.rol === 'Administrador' && !user.mustChange) {
        databaseLinks.forEach(link => { const item=link.closest('li'); if(item)item.hidden=false; });
      }
      if (!user || !userLabel || !loginLink || !registerLink) return;
      userLabel.hidden = false;
      userLabel.textContent = 'Hola, ' + user.nombre;
      loginLink.hidden = true;
      registerLink.hidden = true;
      if (user.rol === 'Administrador' && adminLink) adminLink.hidden = false;
      if (user.rol === 'Empleado' && staffLink) staffLink.hidden = false;
      if (logoutButton) {
        logoutButton.hidden = false;
        logoutButton.addEventListener('click', async () => {
          await fetch('/api/logout', { method: 'POST', credentials: 'include' });
          location.reload();
        });
      }
    })
    .catch(() => {});
})();