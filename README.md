Experimental webrtc proxy app for tunnel connections through external node

Deploy this to your hosting with node.js or express.js(Render,glitch,keroku for example)

On your node from where you want to tunnel app:
curl -fsSL https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.xz | sudo tar -xJ -C /usr/local --strip-components=1 && sudo ln -sf /usr/local/bin/node /usr/bin/node && sudo ln -sf /usr/local/bin/npm /usr/bin/npm
mkdir ~/laptop-webrtc
cd ~/laptop-webrtc
 cat << EOF > package.json
 {
  "name": "webrtc-laptop-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node laptop-client.js",
    "dev": "node laptop-client.js"
  },
  "dependencies": {
    "ws": "^8.13.0",
    "node-fetch": "^3.3.1"
  }
}
EOF

