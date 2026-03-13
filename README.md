# Shelby Quickstart - Super Simple 🚀

Upload and download files to Shelby in 5 minutes.

## ⚡ Quick Start (Copy & Paste)

### Step 1: Install Shelby CLI

```bash
npm install -g @shelby-protocol/cli
```

### Step 2: Setup Account

```bash
# Initialize Shelby
shelby init

# This creates ~/.shelby/config.yaml
# Just press Enter for all prompts (use defaults)
```

### Step 3: Get Free Tokens

Go to: https://faucet.shelbynet.shelby.xyz

1. Paste your address (from `shelby account list`)
2. Click "Fund" for both APT and ShelbyUSD
3. Done!

### Step 4: Upload a File

```bash
# Upload any file
shelby upload myfile.pdf files/myfile.pdf -e tomorrow --assume-yes

# That's it! ✅
```

### Step 5: Download It Back

```bash
shelby download files/myfile.pdf downloaded.pdf
```

---

## 🎯 Common Tasks

### Upload with Custom Expiration

```bash
# 1 hour
shelby upload file.txt files/file.txt -e "in 1 hour" --assume-yes

# 7 days
shelby upload file.txt files/file.txt -e "in 7 days" --assume-yes

# Specific date
shelby upload file.txt files/file.txt -e "2026-12-31" --assume-yes
```

### List Your Files

```bash
shelby account blobs
```

### Check Balance

```bash
shelby account balance
```

### Delete a File

```bash
shelby delete files/myfile.pdf --assume-yes
```

---

## 💡 For Developers: JavaScript Example

### Install SDK

```bash
npm install @shelby-protocol/sdk
```

### Upload Example

```javascript
import { ShelbyClient } from '@shelby-protocol/sdk';

const client = new ShelbyClient({
  privateKey: process.env.SHELBY_PRIVATE_KEY,
  network: 'shelbynet'
});

// Upload
await client.upload('./file.pdf', {
  blobName: 'files/doc.pdf',
  expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
});

console.log('✅ Uploaded!');
```

### Download Example

```javascript
// Download
await client.download('files/doc.pdf', './downloaded.pdf');

console.log('✅ Downloaded!');
```

---

## 🔧 Troubleshooting

### "Insufficient tokens"
→ Visit faucet again: https://faucet.shelbynet.shelby.xyz

### "Upload failed"
→ Check balance: `shelby account balance`
→ Should have both APT and ShelbyUSD

### "File not found"
→ Check if expired: `shelby account blobs`

---

## 📝 Complete Example Project

```bash
# 1. Create project
mkdir my-shelby-app
cd my-shelby-app
npm init -y

# 2. Install SDK
npm install @shelby-protocol/sdk dotenv

# 3. Create .env file
echo "SHELBY_PRIVATE_KEY=your-private-key-here" > .env
echo "SHELBY_NETWORK=shelbynet" >> .env

# 4. Create upload.js
cat > upload.js << 'EOF'
import { ShelbyClient } from '@shelby-protocol/sdk';
import 'dotenv/config';

const client = new ShelbyClient({
  privateKey: process.env.SHELBY_PRIVATE_KEY,
  network: process.env.SHELBY_NETWORK
});

async function main() {
  // Upload
  console.log('📤 Uploading...');
  await client.upload('./test.txt', {
    blobName: 'files/test.txt',
    expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
  console.log('✅ Upload complete!');
  
  // Download
  console.log('📥 Downloading...');
  await client.download('files/test.txt', './downloaded.txt');
  console.log('✅ Download complete!');
}

main();
EOF

# 5. Create test file
echo "Hello Shelby!" > test.txt

# 6. Run it
node upload.js
```

---

## 🎨 Build a File Sharing App (Minimal)

### Simple Express Server

```javascript
// server.js
import express from 'express';
import multer from 'multer';
import { ShelbyClient } from '@shelby-protocol/sdk';

const app = express();
const upload = multer({ dest: 'uploads/' });

const shelby = new ShelbyClient({
  privateKey: process.env.SHELBY_PRIVATE_KEY,
  network: 'shelbynet'
});

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  const shareId = Math.random().toString(36).substring(7);
  
  await shelby.upload(file.path, {
    blobName: `files/${shareId}`,
    expirationDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
  
  res.json({ 
    shareLink: `http://localhost:3000/download/${shareId}` 
  });
});

// Download endpoint
app.get('/download/:id', async (req, res) => {
  const tempPath = `/tmp/${req.params.id}`;
  
  await shelby.download(`files/${req.params.id}`, tempPath);
  
  res.download(tempPath);
});

app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
```

Run:
```bash
npm install express multer
node server.js
```

Upload:
```bash
curl -F "file=@myfile.pdf" http://localhost:3000/upload
# Returns: {"shareLink": "http://localhost:3000/download/abc123"}
```

---

## 📚 Next Steps

1. ✅ Read docs: https://docs.shelby.xyz
2. ✅ Join Discord: https://discord.gg/shelby
3. ✅ Build something cool!
4. ✅ Share with community

---

## 💡 Pro Tips

**Cost optimization:**
- Longer expiration = more cost
- Compress files before upload
- Delete files when done

**Security:**
- Never commit private keys
- Use environment variables
- Encrypt sensitive files client-side

**Performance:**
- Parallel uploads for multiple files
- Cache frequently accessed files
- Use CDN for public files

---

## ❓ Need Help?

**Faucet:** https://faucet.shelbynet.shelby.xyz
**Docs:** https://docs.shelby.xyz
**Discord:** https://discord.gg/shelby
**Twitter:** @shelbyprotocol

---

That's it! You're now ready to build on Shelby. 🎉
