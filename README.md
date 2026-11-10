# 品德作文五站

靜態繁體中文練習頁，供小六品德作文前的五站鞏固。每次做一站，約 8–12 分鐘。不設倒數、不公開排名、不需帳戶，也沒有分析追蹤。

題目與回饋來自 `data/online-stations.json`。英文作答，說明用繁體中文。34 題自動批改，6 題（S3-08、S4-07、S4-08、S5-04、S5-06、S5-07）只供老師核對，不會因字串完全一致而變成已掌握。

自動題第一次答錯只顯示提示。重試另外保存，不計入掌握。老師檢閱題先保留學生寫作，學生自查後才顯示參考例句與「待老師核對」。

進度存在這部裝置的 `localStorage`（鍵名 `p6-moral-composition01.v1`）。首頁可清除本機紀錄。

## 本地開啟

請用網站伺服器開啟資料夾，不要直接點開 `index.html`。

```bash
python3 -m http.server 8765
```

然後打開終端顯示的網址。資源都用相對路徑，日後可以放在 GitHub Pages 子路徑 `/P6-Moral-Composition01/`。

## 測試

```bash
npm test
npm run test:browser
```

`npm test` 檢查評分、進度與靜態檔。`test:browser` 需要本機 Google Chrome，會以 iPhone 11 視窗檢查版面、相對路徑與作答流程，不截圖。
