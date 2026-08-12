$files = Get-ChildItem -Path "C:\Users\yosak\.gemini\antigravity\scratch\selection-progress-app\js" -Recurse -Filter "*.js"

foreach ($file in $files) {
    $text = [System.IO.File]::ReadAllText($file.FullName)
    $openCount = ($text.ToCharArray() | Where-Object { $_ -eq '{' }).Count
    $closeCount = ($text.ToCharArray() | Where-Object { $_ -eq '}' }).Count
    $openParen = ($text.ToCharArray() | Where-Object { $_ -eq '(' }).Count
    $closeParen = ($text.ToCharArray() | Where-Object { $_ -eq ')' }).Count

    if (($openCount -ne $closeCount) -or ($openParen -ne $closeParen)) {
        Write-Host "MISMATCH in $($file.Name): Curly ({ $openCount vs } $closeCount), Paren (( $openParen vs ) $closeParen)"
    }
}
