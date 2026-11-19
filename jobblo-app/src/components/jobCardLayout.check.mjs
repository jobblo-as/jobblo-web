// Run: node src/components/jobCardLayout.check.mjs
// The card's root must not use flex-1. Every list cell (Utforsk, Hjem, profiles, Lignende oppdrag)
// takes its height from the card; with flex-1 (flex-basis 0) RN 0.88 gave the card 0 height on
// iPhone, so the cards piled on top of each other and FlatList stopped rendering the rest.
// Web did not show it (CSS treats flex: 1 differently), so this guards the source instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./JobCard.tsx', import.meta.url), 'utf8');
const root = src.match(/<TouchableOpacity[\s\S]*?className="([^"]*)"/);
assert.ok(root, 'JobCard root TouchableOpacity with a className');
assert.ok(!/(^|\s)flex-1(\s|$)/.test(root[1]), `JobCard root must not be flex-1: "${root[1]}"`);
console.log('jobCardLayout: ok');
