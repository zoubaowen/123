'use strict'

const path = require('node:path')

/**
 * Canonical Python for kid-facing scripts — the managed Hermes venv used by the
 * desktop backend. Editor Run, AI terminal installs, and AI test runs must all
 * use this interpreter (via $VIBE_STUDENT_PYTHON), not bare python3/pip.
 */
function resolveVibeStudentPython(options = {}) {
  const {
    fileExists = () => false,
    venvRoot = '',
    agentRoot = '',
    devSourceRoot = '',
    findPythonForRoot = () => null,
    findSystemPython = () => null,
    override = '',
    isWindows = process.platform === 'win32'
  } = options

  if (override && fileExists(override)) {
    return override
  }

  if (venvRoot) {
    const managed = path.join(venvRoot, isWindows ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'))
    if (fileExists(managed)) {
      return managed
    }
  }

  if (devSourceRoot) {
    const fromDev = findPythonForRoot(devSourceRoot)
    if (fromDev && fileExists(fromDev)) {
      return fromDev
    }
  }

  if (agentRoot) {
    const fromAgent = findPythonForRoot(agentRoot)
    if (fromAgent && fileExists(fromAgent)) {
      return fromAgent
    }
  }

  return findSystemPython() || (isWindows ? 'python' : 'python3')
}

/**
 * GUI toolkits (tkinter/turtle/pygame) should not open a console:
 * - macOS: pythonw / pythonw3
 * - Windows: pythonw.exe (python.exe is a console subsystem)
 */
function resolveVibePythonGuiExecutable(pythonPath, options = {}) {
  const { fileExists = () => false, platform = process.platform } = options

  if (!pythonPath) {
    return pythonPath
  }

  const dir = path.dirname(pythonPath)
  const base = path.basename(pythonPath)
  const candidates = []

  if (platform === 'darwin') {
    if (base === 'python' || base === 'python3') {
      candidates.push(path.join(dir, 'pythonw'), path.join(dir, 'pythonw3'))
    }
  } else if (platform === 'win32') {
    if (/^python\d*\.exe$/i.test(base)) {
      candidates.push(path.join(dir, base.replace(/\.exe$/i, 'w.exe')))
    } else if (base === 'python' || base === 'python3') {
      candidates.push(path.join(dir, 'pythonw.exe'))
    }
  }

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate
    }
  }

  return pythonPath
}

/** @deprecated use resolveVibeStudentPython */
const resolveVibePythonExecutable = resolveVibeStudentPython

module.exports = {
  resolveVibeStudentPython,
  resolveVibePythonExecutable,
  resolveVibePythonGuiExecutable
}
