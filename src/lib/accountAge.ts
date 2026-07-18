export function getAccountAge(createdAt: string): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const years = Math.floor(days / 365);
  const remainingMonths = Math.floor((days % 365) / 30);
  return remainingMonths > 0 ? `${years}y ${remainingMonths}mo` : `${years}y`;
}
