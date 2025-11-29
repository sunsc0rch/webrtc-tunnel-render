Experimental webrtc proxy for tunneling traffic or sharing your local app(website,service etc) via any free simple hosting with js/html support


Deploy this to your lightweight hosting(Render,glitch,heroku,fly.io for example) with node.js,next.js,bun.js or other js runtimes

On your node from where you want to share app:

1.

curl -fsSL https://nodejs.org/dist/v24.11.1/node-v24.11.1-linux-x64.tar.xz | sudo tar -xJ -C /usr/local --strip-components=1 && sudo ln -sf /usr/local/bin/node /usr/bin/node && sudo ln -sf /usr/local/bin/npm /usr/bin/npm

2.
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

3.
copy for_laptop/laptop-client.js to ~/laptop-webrtc

npm install

LOCAL_APP_URL=http://localhost:8100 # your local app on your laptop/pc that you want to share

Change it in laptop-client.js

run it 

RENDER_SERVER=wss://your-webrtc-tunnel-app.onrender.com node laptop-client.js
