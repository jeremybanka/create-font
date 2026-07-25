export const CREATE_FONT_FEA_RESTART_COMMAND =
	`createFont.restartFeatureLanguageServer` as const

export const CREATE_FONT_FEA_SETTINGS = {
	executablePath: `createFont.features.executablePath`,
	logLevel: `createFont.features.logLevel`,
	modulePath: `createFont.features.modulePath`,
	trace: `createFont.features.trace.server`,
} as const

export function createFontFeaVscodeManifest(version: string) {
	return {
		activationEvents: [
			`onLanguage:fea`,
			`workspaceContains:**/features/**/*.fea`,
		],
		categories: [`Programming Languages`, `Linters`],
		contributes: {
			commands: [
				{
					command: CREATE_FONT_FEA_RESTART_COMMAND,
					title: `Create Font: Restart Feature Language Server`,
				},
			],
			configuration: {
				properties: {
					[CREATE_FONT_FEA_SETTINGS.executablePath]: {
						default: ``,
						description: `Optional create-font-fea-lsp executable path. Relative paths resolve from the first workspace root.`,
						type: `string`,
					},
					[CREATE_FONT_FEA_SETTINGS.modulePath]: {
						default: ``,
						description: `Optional language-server module path. Ignored when an executable path is configured.`,
						type: `string`,
					},
					[CREATE_FONT_FEA_SETTINGS.logLevel]: {
						default: `info`,
						description: `Operational server logging, separate from protocol tracing.`,
						enum: [`off`, `error`, `info`, `debug`],
						type: `string`,
					},
					[CREATE_FONT_FEA_SETTINGS.trace]: {
						default: `off`,
						description: `Trace communication between VS Code and the feature language server.`,
						enum: [`off`, `messages`, `verbose`],
						type: `string`,
					},
				},
				title: `Create Font Features`,
			},
			grammars: [
				{
					language: `fea`,
					path: `./syntaxes/fea.tmLanguage.json`,
					scopeName: `source.fea`,
				},
			],
			languages: [
				{
					aliases: [`Adobe Feature File`, `fea`],
					configuration: `./language-configuration.json`,
					extensions: [`.fea`],
					id: `fea`,
				},
			],
		},
		description: `Adobe Feature File diagnostics and project-aware language tooling for create-font.`,
		displayName: `Create Font Features`,
		engines: { vscode: `^1.100.0` },
		extensionKind: [`workspace`],
		files: [`dist`, `syntaxes`, `language-configuration.json`, `README.md`],
		license: `MIT`,
		main: `./dist/extension.cjs`,
		name: `create-font-features`,
		private: true,
		publisher: `jeremybanka`,
		repository: {
			directory: `packages/create-font`,
			type: `git`,
			url: `https://github.com/jeremybanka/create-font.git`,
		},
		type: `module`,
		version,
	}
}
