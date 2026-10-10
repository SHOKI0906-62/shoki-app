# 昇起施術所 管理アプリ（予約・顧客・カルテ・売上）

決まったことはここにまとめ、変更のたびに更新する。

## 治療院
- Total Conditioning Room 昇起施術所（一人治療院・紹介制・自由診療）
- コース：60分 8,000円／90分 11,000円／120分 15,000円
- お客さんはゴルフをする人が多い。経穴は WHO 標準表記（例：LI4 合谷）

## 使う人・説明のしかた
- 使う人：本人1人のみ（鍼灸あんまマッサージ指圧師）
- プログラミング初心者。**説明は簡単な日本語**、専門用語には一言説明を付ける
- 一度に全部作らず、段階を分けて少しずつ作る
- 目標は「考える手間ゼロ」：なるべくタップだけで入力

## 端末
- Android タブレット（POCO Pad M1 / Chrome）と iPhone（Safari）
- ブラウザで開き「ホーム画面に追加」してアプリとして使う（PWA）
- スマホで押しやすい大きなボタン

## アカウント
- Firebase と Google カレンダーは Google アカウント **t.shoki16@gmail.com** で作る
- GitHub は shoki0906-62（karada-app と同じ）
- Firebase は karada-app とは**別のプロジェクト**にする（健康情報を分けて守るため）

## 技術の決まりごと（karada-app と同じ作り方）
- ビルド不要の素のHTML/CSS/JavaScript（ES Modules）。フレームワークなし
- 公開：GitHub Pages（リポジトリ SHOKI0906-62/shoki-app → https://shoki0906-62.github.io/shoki-app/ ）
- 保存：Firebase（Firestore）。iPhone とタブレットを同期。Firebase SDK は gstatic の CDN から読み込む
- 画面(app.js)は保存係(store.js)の関数だけを使う
- `firebase-config.js` が空なら「お試しモード」（localStorage・ダミーデータ）で動く。本物のお客さん情報はお試しモードに入れない

### ログイン
- **メール＋パスワード**（Firebase Authentication）。iPhone のホーム画面アプリでも確実に動くため。Googleログインは使わない
- ログイン状態は端末に保存され、毎回のログインは不要（ログアウトを押すまで続く）
- 新規登録画面は作らない。ユーザーは Firebase コンソールで1人だけ作る

### Google カレンダー連携
- **Google Apps Script（GAS）** を使う。t.shoki16 のアカウントで動く小さなプログラムで、アプリから「予定を作って／変えて／消して」と頼むと、カレンダー「昇起施術所 予約」に反映する
  - 理由：アプリ側で Google ログインをしなくてよい（iPhone のホーム画面アプリでも確実）。無料で使える
- カレンダーの予定の名前は **「名字＋下の名前の頭文字＋コース」だけ**（例：田中K 90分）。健康の情報は入れない（2026-10-10決定）
- 通知：開始1時間前
- 合言葉（秘密の文字列）で本人のアプリからの依頼だけ受け付ける。合言葉はコードに書かず、ログイン後に Firestore から読む
- 予定のIDを予約データに保存し、変更・キャンセルのときに同じ予定を直す／消す
- 電波がなくて失敗したら「未反映」と表示し、あとで再送できるようにする

## セキュリティ（最優先）
- Firestore ルール（`firestore.rules`）：ログインした本人の UID（2bMt67SKhqSAz4LjSa5knTxjcQt2）**だけ**が `users/{UID}/...` を読み書きできる。UID はルールに直接書く（万一ほかのアカウントができても読めない）。それ以外は全部拒否
- 新規登録（サインアップ）をできないようにする（Firebase の設定＋ルールの二重の鍵）
- メールアドレス列挙保護（Email enumeration protection）を ON
- Googleログイン・SMS多要素認証は使わない（iPhoneのホーム画面で不安定／SMSは有料のため）
- Identity Platform へアップグレード済み（2026-10-10、Sparkのまま無料。1日3,000人まで）。新規登録オフの設定（ユーザー アクション）を出すため。元には戻せない
- Blaze（有料プラン）にはしない
- 公開後、**ログインしていない状態でデータが読めないこと**をテストする（Firestore の REST API にログインなしで頼んで「拒否」されるか確認）
- データの場所は東京（asia-northeast1）
- GitHub のリポジトリにはお客さんのデータを**絶対に入れない**（コードだけ）。バックアップファイルもリポジトリに入れない
- バックアップ（書き出し）：JSON で全データを書き出すボタン。パスワードで暗号化して保存できるようにする（予定）
- 端末側：iPhone・タブレットとも画面ロック（パスコード／顔認証）必須。Google アカウントは2段階認証を ON
- 個人情報保護法：健康の情報は「要配慮個人情報」。初回に同意をもらう（問診票などに一文）

## ファイル
- `CLAUDE.md` 決まったこと / `js/firebase-config.js` Firebaseの設定値 / `firestore.rules` データの鍵 / `SETUP.md` 本人の準備手順 / `.gitignore` バックアップファイルをリポジトリに入れないための設定

## データの形（Firestore・案）
- `users/{uid}/clients/{id}` 顧客：`{lastName:'田中', firstName:'健一', initial:'K', kana?, ageGroup:'40代', gender, height, weight, job:'経営者'|'会社員'|…, referral:{type:'person'|'card'|'other', clientId?, name?}, firstVisit:'YYYY-MM-DD', memo, createdAt}`
  - 住所・生年月日・電話番号・会社名は**入れない**
  - initial（下の名前の頭文字・ローマ字大文字1文字）はカレンダー用。A〜Zのボタンで選ぶ
- `users/{uid}/reservations/{id}` 予約：`{date, start:'HH:MM', clientId, course:60|90|120, status:'booked'|'done'|'cancelled', calEventId, calSync:'ok'|'pending'|'error'}`
- `users/{uid}/visits/{id}` 来院記録（カルテ）：`{date, clientId, reservationId?, course, complaint, areas[], points[], memo, payment:'現金'|'無料招待', amount, freeInvite:boolean}`
  - 支払い方法は **現金・無料招待の2つ**（2026-10-10決定）
  - 招待カード「60分無料」は payment:'無料招待'・amount:0・freeInvite:true
- `users/{uid}/meta/settings` コース・料金・職業や部位のボタン一覧・GAS の URL と合言葉
- 集計（月別売上など）は保存せず、visits から毎回計算する

## 集計のことばの意味
- リピート率：来院が2回以上ある人 ÷ 来院したことのある人
- 無料招待→有料リピート：初回が無料招待で、そのあと有料の来院が1回以上ある人の数

## 作る順番
- [ ] ステップ0：本人の準備（GitHub・Firebase・Google カレンダー）→ SETUP.md（2026-10-10 開始）
  - [x] GitHub リポジトリ shoki-app 作成（2026-10-10、Public）
  - [x] Firebase プロジェクト作成（ID：shoki-app-efb45、Spark＝無料）・Webアプリ登録 → `js/firebase-config.js`
  - [x] Authentication：メール/パスワード有効、ユーザー t.shoki16@gmail.com 追加（UID：`2bMt67SKhqSAz4LjSa5knTxjcQt2`）
  - [x] 新規登録オフ・削除オフ（2026-10-10）。Google Cloud の Identity Platform → 設定 → ユーザー → ユーザー アクション で設定
    - テスト：ログインなしで新規登録を試すと ADMIN_ONLY_OPERATION（拒否）になることを確認済み
    - 設定画面：https://console.cloud.google.com/customer-identity/settings?project=shoki-app-efb45&authuser=t.shoki16@gmail.com （Firebase の画面にはない）
  - [x] Firestore 作成（(default)、asia-northeast1、本番環境モード）。ログインなしの読み書きが 403 で拒否されることを確認済み（2026-10-10）
  - [x] Firestore のルールに `firestore.rules` を貼り付けて公開（2026-10-10）。公開後もログインなしは全部 403 を確認。ルールを変えたら Firebase の「ルール」にも貼り直して公開する
  - [x] Google カレンダー「昇起施術所 予約」作成（2026-10-10、t.shoki16）。※別に「昇起施術所」というカレンダーもある（用途を本人に確認中）。アプリが書き込むのは「予約」の方だけ
  - [ ] カレンダーIDを受け取る（次回ここから：「昇起施術所 予約」の ⋮ → 設定と共有 → カレンダーの統合 → カレンダー ID）。一般公開がオフかも確認
  - メモ：タブレットの Chrome は golf.shoki.1987 が既定アカウント。リンクには `authuser=t.shoki16@gmail.com` を付ける。カレンダーは Chrome の「PC版サイト」で開く
- [ ] ステップ1：土台＋顧客台帳＋バックアップ
  - ログイン、セキュリティルール、未ログインで読めないことのテスト
  - 顧客の登録・編集・一覧・検索（年代・性別・職業・紹介元はボタンで選ぶ）
  - 全データの書き出し（JSON）
- [ ] ステップ2：予約＋Googleカレンダー連携
  - 日付→時間→お客さん→コースをタップで選ぶ。今日・今週の予約一覧
  - 変更・キャンセルもカレンダーに反映（GAS）
- [ ] ステップ3：来院記録（カルテ）
  - 予約の「来院済み」→ カルテ入力画面 → 保存で売上と来院履歴に入る
  - 施術部位はボタン、経穴は WHO 標準（361穴）から検索／よく使う順／経絡別に選ぶ
  - 支払い方法・金額はコースから自動（無料招待ボタンで0円）
  - お客さんごとの来院履歴一覧
- [ ] ステップ4：売上・集計
  - 月別売上、コース別、紹介元別、来院回数、リピート率、無料招待→有料リピート人数
  - 確定申告用のCSV書き出しは**作らない**（2026-10-10決定）
- [ ] ステップ5（あとで）：バックアップの暗号化・読み込み（復元）、アプリを開くときの PIN など
