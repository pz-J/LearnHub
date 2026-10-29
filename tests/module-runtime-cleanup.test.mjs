import test from 'node:test'
import assert from 'node:assert/strict'
import { useReaderState, clearModuleReaderButtons } from '../src/renderer/src/stores/readerState.ts'

test('module lifecycle cleanup removes only the disabled module toolbar registrations', () => {
  const state = useReaderState.getState()
  state.registerButton('qa.disabled-module', { id: 'open', title: 'QA Open' })
  state.registerButton('qa.disabled-module', { id: 'copy', title: 'QA Copy' })
  state.registerButton('qa.other-module', { id: 'keep', title: 'Keep This' })

  clearModuleReaderButtons('qa.disabled-module')

  assert.deepEqual(useReaderState.getState().toolbarButtons, [
    { moduleId: 'qa.other-module', id: 'keep', title: 'Keep This' }
  ])
  clearModuleReaderButtons('qa.other-module')
})
