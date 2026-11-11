function isWhatsAppOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["whatsapp.com", "whatsapp.net"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function allowPermission(permission, origin) {
  return isWhatsAppOrigin(origin) && ["notifications", "persistent-storage"].includes(permission);
}

function configureAccountSession(accountSession, { preconnect = true } = {}) {
  accountSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowPermission(permission, details?.requestingUrl || contents?.getURL()));
  });
  accountSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => allowPermission(permission, requestingOrigin));
  if (preconnect) {
    for (const url of ["https://web.whatsapp.com", "https://static.whatsapp.net"]) {
      accountSession.preconnect({ url, numSockets: 2 });
    }
  }
}

module.exports = { configureAccountSession, allowPermission };
