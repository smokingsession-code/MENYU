/** The cookie that remembers which branch an owner is looking at, per restaurant. */
export function branchCookie(restaurantId: string): string {
  return `menyu_branch_${restaurantId.replace(/-/g, "")}`;
}
