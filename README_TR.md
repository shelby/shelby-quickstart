# 🇹🇷 Shelby Shelbynet — Türkçe Kurulum ve Test Rehberi

> Bu rehber, Shelby'nin beta testnet'ine (shelbynet) sıfırdan katılmak isteyenler için yazılmıştır.
> Kod bilgisi gerekmez.

---

## 📋 Gereksinimler

- Mac veya Linux bilgisayar
- Node.js v22 veya üzeri
- Aptos cüzdanı (Petra önerilir)

---

## 1️⃣ Node.js Kurulumu

**nodejs.org** adresine gir, **LTS** butonuna tıkla ve kur.

Kurulumu doğrula:
```bash
node --version
# v24.x.x gibi bir çıktı görmelisin
```

---

## 2️⃣ Shelby CLI Kurulumu
```bash
sudo npm i -g @shelby-protocol/cli
```

Kurulumu doğrula:
```bash
shelby --version
# 0.0.26
```

---

## 3️⃣ Aptos CLI Kurulumu
```bash
curl -fsSL "https://aptos.dev/scripts/install_cli.sh" | sh
source ~/.profile
```

---

## 4️⃣ Shelby'yi Başlat
```bash
shelby init
```

"Configuration complete!" görürsen ✅ tamam.

---

## 5️⃣ Shelbynet'e Geç
```bash
shelby context use shelbynet
```

---

## 6️⃣ Ücretsiz Token Al
```bash
shelby faucet --network shelbynet
```

Bakiyeni kontrol et:
```bash
shelby account balance
```

---

## 7️⃣ Test Dosyası Oluştur ve Yükle
```bash
echo "Shelby test dosyasi" > ~/Desktop/test.txt
shelby upload ~/Desktop/test.txt test/test.txt -e tomorrow --assume-yes
```

---

## 8️⃣ Shelby Explorer
```
explorer.shelby.xyz
```

Sağ üstten **SHELBYNET** seçili olduğuna dikkat et.

---

## 🐛 Hata Bulursan Raporla

**github.com/shelby/feedback** → New Issue → Bug report

Her rapor testnet katkısı sayılır!

---

## ❓ Yardım

- Dokümantasyon: [docs.shelby.xyz](https://docs.shelby.xyz)
- Twitter: [@shelbyserves](https://x.com/shelbyserves)

---

*Bu rehber topluluk katkısıyla hazırlanmıştır.*
