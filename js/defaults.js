// 最初の設定値。設定画面で変えると Firestore の meta/settings に保存され、そちらが優先される。
export const DEFAULT_SETTINGS = {
  ageGroups: ['10代', '20代', '30代', '40代', '50代', '60代', '70代〜'],
  genders: ['男性', '女性'],
  jobs: ['経営者', '役員', '会社員', '医師・士業', '自営業', '主婦・主夫', '学生', '無職・引退', 'その他'],
  courses: [
    { min: 60, price: 8000 },
    { min: 90, price: 11000 },
    { min: 120, price: 15000 },
  ],
};

// 紹介元の種類（データに保存する値 → 画面の表示）
export const REFERRAL_TYPES = [
  { value: 'person', label: 'お客さんの紹介' },
  { value: 'card', label: '招待カード' },
  { value: 'other', label: 'その他' },
];

// カレンダーの予定名に使う「下の名前の頭文字」
export const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
