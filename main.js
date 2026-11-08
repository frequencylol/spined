// language: Node.js (Electron main process), file: main.js — spined.lol v4.0
// created by 0847x
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Start the Express + WS server
const { server, PORT } = require('./server');

let win;

function createWindow() {
  win = new BrowserWindow({
    width         : 1400,
    height        : 900,
    minWidth      : 1100,
    minHeight     : 700,
    backgroundColor: '#111111',
    icon          : path.join(__dirname, 'spine.png'),
    titleBarStyle  : 'hidden',
    titleBarOverlay: {
      color       : '#181818',
      symbolColor : '#888888',
      height      : 46,
    },
    webPreferences : {
      nodeIntegration  : false,
      contextIsolation : true,
      webSecurity      : true,
    },
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const tryLoad = () => {
    if (server.listening) {
      win.loadURL(`http://localhost:${PORT}`);
    } else {
      server.once('listening', () => win.loadURL(`http://localhost:${PORT}`));
    }
  };
  tryLoad();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
