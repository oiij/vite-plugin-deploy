import antfu from '@antfu/eslint-config'

export default antfu({
  'ts/consistent-type-definitions': ['error', 'type'],
  'ignores': [
    '.agents',
  ],
})
