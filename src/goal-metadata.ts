export function extractGoalDirectives(source: any): any {
  const lines = String(source ?? '').split(/\r?\n/);
  const goals: any[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line) continue;
    const match = line.match(/^\s*%%\s*goal:\s*(.*)$/);
    if (!match) continue;
    let goal = match[1] ?? '';
    while (lines[index + 1] && lines[index + 1]!.match(/^\s*%%/) && !lines[index + 1]!.match(/^\s*%%\s*goal:/)) {
      index++;
      goal += `\n${lines[index]!.replace(/^\s*%%\s?/, '')}`;
    }
    goals.push(goal.trim());
  }
  return goals;
}

export const goalsFromSource = extractGoalDirectives;
