export const zh = {
  'bg.decodeFailed': '這張圖無法解碼',
  'bg.decodeDetail': '檔案 {name}・{type}・{size}。瀏覽器兩種解碼方式都失敗了（{a} / {b}）。手機拍的超大照片可能因記憶體不足而失敗，可先用相簿的編輯功能裁切後再試。',
  'bg.unnamed': '(未命名)',
  'bg.unknownType': '未知格式',
  'bg.noCanvas': '瀏覽器不支援圖片處理',
  'bg.noCanvasDetail': '無法取得 canvas 2d context。',
  'bg.drawFailed': '繪製圖片時失敗',
  'bg.drawDetail': '原圖 {w}×{h}・{size}・解碼方式 {via}。{err}',
  'bg.encodeFailed': '瀏覽器無法壓縮這張圖',
  'bg.encodeDetail': '要求 {wanted} 但得到 {got}。請改用其他瀏覽器再試。',
  'bg.tooLarge': '這張圖壓縮後仍然太大',
  'bg.tooLargeDetail': '最小壓到 {smallest}，超過 {limit} 的上限。原圖 {w}×{h}・{size}・格式 {mime}。試著把縮放調小一點，或換一張細節較少的圖。',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'bg.decodeFailed': 'This image couldn\'t be decoded',
  'bg.decodeDetail':
    'File {name} · {type} · {size}. Both of the browser\'s decoding methods failed ({a} / {b}). A very large phone photo can fail for lack of memory — try cropping it in your photo app first.',
  'bg.unnamed': '(unnamed)',
  'bg.unknownType': 'unknown format',
  'bg.noCanvas': 'This browser can\'t process images',
  'bg.noCanvasDetail': 'Couldn\'t get a canvas 2d context.',
  'bg.drawFailed': 'Drawing the image failed',
  'bg.drawDetail': 'Original {w}×{h} · {size} · decoded via {via}. {err}',
  'bg.encodeFailed': 'This browser can\'t compress the image',
  'bg.encodeDetail': 'Asked for {wanted} but got {got}. Please try a different browser.',
  'bg.tooLarge': 'The image is still too large after compression',
  'bg.tooLargeDetail':
    'Smallest result was {smallest}, over the {limit} limit. Original {w}×{h} · {size} · format {mime}. Try zooming out a bit, or use a picture with less detail.',
};

export const ja: Record<keyof typeof zh, string> = {
  'bg.decodeFailed': 'この画像をデコードできません',
  'bg.decodeDetail':
    'ファイル {name}・{type}・{size}。ブラウザの2つのデコード方法がどちらも失敗しました（{a} / {b}）。スマホで撮った非常に大きな写真はメモリ不足で失敗することがあります。先にフォトアプリで切り抜いてからお試しください。',
  'bg.unnamed': '(名前なし)',
  'bg.unknownType': '不明な形式',
  'bg.noCanvas': 'このブラウザは画像処理に対応していません',
  'bg.noCanvasDetail': 'canvas の 2d コンテキストを取得できませんでした。',
  'bg.drawFailed': '画像の描画に失敗しました',
  'bg.drawDetail': '元画像 {w}×{h}・{size}・デコード方法 {via}。{err}',
  'bg.encodeFailed': 'このブラウザでは画像を圧縮できません',
  'bg.encodeDetail': '{wanted} を要求しましたが {got} になりました。別のブラウザでお試しください。',
  'bg.tooLarge': '圧縮後も画像が大きすぎます',
  'bg.tooLargeDetail':
    '最小でも {smallest} で、上限 {limit} を超えています。元画像 {w}×{h}・{size}・形式 {mime}。拡大率を少し下げるか、細部の少ない画像をお試しください。',
};
