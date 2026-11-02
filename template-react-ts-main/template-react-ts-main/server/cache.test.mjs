import assert from 'node:assert/strict';
import test from 'node:test';
import { diffCourses, fingerprintCourse } from './cache.mjs';
const course = (id, title) => ({ id, title, fingerprint: fingerprintCourse({ id, title }) });
test('fingerprints are stable and detect metadata changes', () => {
  assert.equal(fingerprintCourse({ id: '1', title: 'A' }), fingerprintCourse({ id: '1', title: 'A' }));
  assert.notEqual(fingerprintCourse({ id: '1', title: 'A' }), fingerprintCourse({ id: '1', title: 'B' }));
});
test('diff reports additions, updates, and removals by stable id', () => {
  assert.deepEqual(diffCourses([course('1', 'A'), course('2', 'B')], [course('1', 'Changed'), course('3', 'C')]), { added: ['3'], updated: ['1'], removed: ['2'] });
});
