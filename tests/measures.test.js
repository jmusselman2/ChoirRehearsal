import test from 'node:test';
import assert from 'node:assert/strict';
import { readMeasureBeats } from '../app/js/score/measures.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Tenor</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
    <measure number="1">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><tied type="start"/></notations></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><grace/><pitch><step>E</step><octave>4</octave></pitch><type>eighth</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
    <measure number="3">
      <attributes><divisions>2</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>6</duration><type>half</type><dot/></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice></note>
      <forward><duration>4</duration></forward>
    </measure>
  </part>
  <part id="P2">
    <measure number="0"><attributes><divisions>1</divisions></attributes><note><rest/><duration>9</duration></note></measure>
  </part>
</score-partwise>`;

test('reads each measure length in quarter-note beats, including a pickup and meter changes', () => {
  const beats = readMeasureBeats(XML, 'P1');
  assert.deepEqual([...beats.entries()], [[0, 1], [1, 4], [2, 2], [3, 3]]);
});

test('reads the requested part only', () => {
  assert.deepEqual([...readMeasureBeats(XML, 'P2').entries()], [[0, 9]]);
  assert.equal(readMeasureBeats(XML, 'P9').size, 0);
  assert.equal(readMeasureBeats(XML).get(0), 1, 'defaults to the first part');
});
