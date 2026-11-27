import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['dist/**', 'bin/**', 'coverage/**', 'progress/**'] }, ...tseslint.configs.recommended);
