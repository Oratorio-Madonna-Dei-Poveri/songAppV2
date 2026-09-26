window.addEventListener('error', function(e) {
  const errDiv = document.createElement('div');
  errDiv.style.position = 'fixed';
  errDiv.style.top = '0';
  errDiv.style.left = '0';
  errDiv.style.width = '100%';
  errDiv.style.background = 'red';
  errDiv.style.color = 'white';
  errDiv.style.padding = '10px';
  errDiv.style.zIndex = '99999';
  errDiv.style.fontSize = '12px';
  errDiv.style.fontFamily = 'monospace';
  errDiv.innerHTML = `<b>Error:</b> ${e.message}<br><b>File:</b> ${e.filename}<br><b>Line:</b> ${e.lineno}`;
  document.body.appendChild(errDiv);
});

window.addEventListener('unhandledrejection', function(e) {
  const errDiv = document.createElement('div');
  errDiv.style.position = 'fixed';
  errDiv.style.top = '50px';
  errDiv.style.left = '0';
  errDiv.style.width = '100%';
  errDiv.style.background = 'orange';
  errDiv.style.color = 'white';
  errDiv.style.padding = '10px';
  errDiv.style.zIndex = '99999';
  errDiv.style.fontSize = '12px';
  errDiv.style.fontFamily = 'monospace';
  errDiv.innerHTML = `<b>Promise Rejection:</b> ${e.reason}`;
  document.body.appendChild(errDiv);
});
