/**
 * 文件夹封面策略。
 *
 * - 含子文件夹的容器默认拼贴，能表达“这一批由什么组成”；
 * - 相册（没有子文件夹）用单图，因为它的内容是一套作品；
 * - 样本不足 3 张时拼贴会重复同一张图，退回单图；
 * - 设置里的 collage / single 可以强制覆盖。
 */
export function shouldUseCollage(cardData, mode = 'auto') {
  if (!cardData) return false;
  const samples = cardData.samples || cardData.previewSamples || [];
  if (samples.length < 3) return false;
  if (mode === 'single') return false;
  if (mode === 'collage') return true;
  return (cardData.childFolders || 0) > 0;
}
