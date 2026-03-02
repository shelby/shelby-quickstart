# Windows (WSL) Setup for Shelby CLI

This guide shows how to run Shelby CLI on Windows using WSL (Ubuntu).

## 1) Install / Open WSL (Ubuntu)
Open PowerShell as Administrator:

- Check WSL:
  - `wsl --version`

- If not installed:
  - `wsl --install -d Ubuntu`

Launch Ubuntu:
- `wsl`

## 2) Update packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl unzip ca-certificates
3) Install Node.js (v22+)

(If you already have Node 22+, skip.)

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
4) Install Aptos CLI (Linux x86_64)
cd ~
curl -L -o aptos-cli.zip https://github.com/aptos-labs/aptos-core/releases/download/aptos-cli-v8.1.0/aptos-cli-8.1.0-Linux-x86_64.zip
unzip -o aptos-cli.zip
chmod +x aptos
sudo mv aptos /usr/local/bin/aptos
aptos --version
5) Install Shelby CLI
npm i -g @shelby-protocol/cli
shelby --help
6) Access Windows files from WSL

Windows drives are mounted under /mnt.

Common paths:

Downloads: /mnt/c/Users/<you>/Downloads

Desktop (may be OneDrive): /mnt/c/Users/<you>/OneDrive/Desktop

List files:

ls -lah /mnt/c/Users/<you>/Downloads | head

Upload a file (quotes required if the name has spaces):

shelby upload "/mnt/c/Users/<you>/Downloads/My Video.mp4" "files/my-video.mp4" -e tomorrow --assume-yes
Troubleshooting
"shelby: command not found"

If npm i -g @shelby-protocol/cli succeeded but shelby is not found, your global npm bin directory may not be on PATH.

Find the global prefix:

npm prefix -g

Check if shelby exists under <prefix>/bin:

ls -la "$(npm prefix -g)/bin" | head

Add it to PATH (bash):

echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
which shelby
shelby --help

Note:

Some tools set a custom npm prefix (e.g., ~/.hermes/node). This is fine — just ensure <prefix>/bin is in PATH.
