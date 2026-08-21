import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import axe from 'axe-core'
import test from 'node:test'

test('the skeleton accessibility fixture has no axe violations', async () => {
  const html = await readFile(new URL('../accessibility/smoke.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only' })

  try {
    dom.window.eval(axe.source)
    const results = await dom.window.axe.run(dom.window.document, {
      runOnly: {
        type: 'rule',
        values: ['button-name', 'document-title', 'heading-order', 'html-has-lang', 'landmark-one-main'],
      },
    })
    assert.equal(results.violations.length, 0)
  } finally {
    dom.window.close()
  }
})