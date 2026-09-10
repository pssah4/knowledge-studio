// From vault-operator-skills tools/lib/build.mjs, Apache-2.0. See ORIGIN.json.
const RUNTIME_REL='references/runtime.md';
export class BuildError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BuildError';
    }
}

/**
 * Split a runtime.md into the shared preamble and one entry per host section.
 * Level-2 headings only: a `###` inside a section belongs to that section.
 */
export function splitRuntimeSections(md) {
    const lines = md.split('\n');
    const preamble = [];
    const sections = new Map();
    let current = null;
    let buffer = [];
    const flush = () => {
        if (current !== null) sections.set(current, buffer.join('\n'));
    };
    for (const line of lines) {
        const heading = /^## (.+?)\s*$/.exec(line);
        if (heading) {
            flush();
            current = heading[1];
            buffer = [];
            continue;
        }
        (current === null ? preamble : buffer).push(line);
    }
    flush();
    return { preamble: preamble.join('\n'), sections };
}

/** The runtime.md a single host receives: the preamble plus its own section. */
export function trimRuntimeForHost(md, sectionTitle) {
    const { preamble, sections } = splitRuntimeSections(md);
    if (!sections.has(sectionTitle)) {
        throw new BuildError(
            `${RUNTIME_REL} has no "## ${sectionTitle}" section, so a copy built for that host would `
            + `carry no calls at all. Sections present: ${[...sections.keys()].join(', ') || 'none'}.`,
        );
    }
    const body = sections.get(sectionTitle).replace(/\s+$/, '');
    return `${preamble.replace(/\s+$/, '')}\n\n## ${sectionTitle}\n${body}\n`;
}

