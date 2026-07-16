import { vi } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: vi.fn(() => ({
            get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
            update: vi.fn(),
        })),
        asRelativePath: vi.fn((uri: string) => uri),
        fs: {
            readFile: vi.fn(),
            writeFile: vi.fn(),
            createDirectory: vi.fn(),
            readDirectory: vi.fn(),
        },
    },
    window: {
        createStatusBarItem: vi.fn(() => ({
            show: vi.fn(),
            hide: vi.fn(),
            dispose: vi.fn(),
            command: '',
            text: '',
            tooltip: '',
            backgroundColor: undefined,
        })),
        activeTextEditor: undefined,
        state: { focused: true },
        activeColorTheme: { kind: 2 },
        onDidChangeWindowState: vi.fn(),
        onDidChangeActiveTextEditor: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
        showQuickPick: vi.fn(),
        showInputBox: vi.fn(),
        showSaveDialog: vi.fn(),
    },
    commands: {
        registerCommand: vi.fn(),
        executeCommand: vi.fn(),
    },
    StatusBarAlignment: { Right: 2 },
    ThemeColor: vi.fn(),
    ConfigurationTarget: { Global: 1 },
    Uri: {
        file: vi.fn((path: string) => ({ fsPath: path, scheme: 'file' })),
        joinPath: vi.fn((base: unknown, ...segments: string[]) => ({
            fsPath: String((base as { fsPath: string })?.fsPath ?? '') + '/' + segments.join('/'),
            scheme: 'file',
        })),
    },
    extensions: {
        getExtension: vi.fn(),
    },
}));
