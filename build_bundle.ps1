$files = @(
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\constants.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\store.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\yomiCalculations.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\sortUtils.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\kanbanCalculations.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\exportUtils.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\mailTemplate.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\utils\csvImporter.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\header.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\sidebar.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\dashboardView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\selectionListView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\selectionDetailModal.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\kanbanView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\caView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\raView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\companyActionListView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\emailComposerModal.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\consultantView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\companyView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\jobView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\masterManagementView.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\csvImportModal.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\components\newSelectionModal.js",
    "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\app.js"
)

$combined = ""
foreach ($f in $files) {
    if (Test-Path $f) {
        $text = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
        # remove import statements
        $text = [System.Text.RegularExpressions.Regex]::Replace($text, "(?m)^import\s+[\s\S]*?from\s+['""][^'""]+['""];?", "")
        # remove export keywords
        $text = [System.Text.RegularExpressions.Regex]::Replace($text, "(?m)^export\s+default\s+", "")
        $text = [System.Text.RegularExpressions.Regex]::Replace($text, "(?m)^export\s+", "")
        $combined += $text + "`n`n"
    }
}

$targetPath = "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js\bundle.js"
[System.IO.File]::WriteAllText($targetPath, $combined, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "js/bundle.js successfully created with 5-phase whiteboard!"
