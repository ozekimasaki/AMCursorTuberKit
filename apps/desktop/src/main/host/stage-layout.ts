interface Size {
  width: number
  height: number
}

/** 画面の作業領域に収まるよう縮めたステージの初期サイズ（縦横比は保つ。拡大はしない） */
export function initialStageSize(stage: Size, workArea: Size): Size {
  const scale = Math.min(1, (workArea.width * 0.6) / stage.width, (workArea.height * 0.7) / stage.height)
  return { width: Math.round(stage.width * scale), height: Math.round(stage.height * scale) }
}

/** 比率が変わったとき、今の面積に近い大きさで新しい比率のサイズを返す。比率が同じなら null */
export function resizeForRatio(current: Size, stage: Size): Size | null {
  const ratio = stage.width / stage.height
  if (Math.abs(current.width / current.height - ratio) <= 0.01) return null
  const height = Math.round(Math.sqrt((current.width * current.height) / ratio))
  return { width: Math.round(height * ratio), height }
}
