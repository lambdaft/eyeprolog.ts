// Host-supplied goal metadata embedded in ordinary Prolog comments.
// The source remains valid ISO Prolog text because processors may ignore it.
export function goalsFromSource(source) {
    const goals = [];
    const lines = String(source ?? '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        // @ts-expect-error TS2532: auto-suppressed
        const match = lines[index].match(/^\s*%%\s*goal:\s*(.*)$/);
        if (!match)
            continue;
        let goal = match[1];
        // @ts-expect-error TS2532: auto-suppressed
        while (lines[index + 1]?.match(/^\s*%%/) && !lines[index + 1].match(/^\s*%%\s*goal:/)) {
            index++;
            // @ts-expect-error TS2532: auto-suppressed
            goal += `\n${lines[index].replace(/^\s*%%\s?/, '')}`;
        }
        // @ts-expect-error TS18048: auto-suppressed
        goals.push(goal.trim());
    }
    return goals;
}
