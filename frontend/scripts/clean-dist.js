const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function removeDir(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  // Пытаемся использовать PowerShell для принудительного удаления на Windows
  if (process.platform === 'win32') {
    try {
      console.log('Попытка удаления через PowerShell...');
      execSync(`powershell -Command "if (Test-Path '${dir}') { Remove-Item -Path '${dir}' -Recurse -Force -ErrorAction SilentlyContinue }"`, { stdio: 'inherit' });
      if (!fs.existsSync(dir)) {
        console.log('Папка успешно удалена через PowerShell.');
        return;
      }
    } catch (err) {
      console.warn('Ошибка при удалении через PowerShell:', err.message);
    }
  }

  // Обычное удаление
  try {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      
      try {
        const stat = fs.lstatSync(filePath);
        
        if (stat.isDirectory()) {
          removeDir(filePath);
        } else {
          // Попытка удалить файл с повторными попытками
          let attempts = 0;
          while (attempts < 5) {
            try {
              fs.unlinkSync(filePath);
              break;
            } catch (err) {
              attempts++;
              if (attempts < 5) {
                // Ждем немного перед повторной попыткой
                const start = Date.now();
                while (Date.now() - start < 200) {}
              } else {
                console.warn(`Не удалось удалить файл: ${filePath}`);
                console.warn('Возможно, файл используется другим процессом. Закройте все приложения Electron и попробуйте снова.');
              }
            }
          }
        }
      } catch (err) {
        console.warn(`Ошибка при обработке: ${filePath}`, err.message);
      }
    }
    
    // Удаляем директорию
    try {
      fs.rmdirSync(dir);
    } catch (err) {
      // Игнорируем ошибки удаления директории
      console.warn(`Не удалось удалить директорию: ${dir}`);
      console.warn('Попробуйте закрыть все приложения Electron и запустить сборку снова.');
    }
  } catch (err) {
    console.warn(`Ошибка при очистке директории: ${dir}`, err.message);
  }
}

const distDir = path.join(__dirname, '..', 'dist');
const distBuildDir = path.join(__dirname, '..', 'dist-build');
console.log('Очистка папок dist и dist-build...');

// Очищаем также dist-build на случай если используется альтернативная директория
removeDir(distBuildDir);

if (fs.existsSync(distDir)) {
  console.warn('ВНИМАНИЕ: Папка dist не была полностью удалена.');
  console.warn('Попытка переименовать папку dist...');
  
  // Пытаемся переименовать папку вместо удаления
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const newName = `dist.old.${timestamp}`;
    const newPath = path.join(__dirname, '..', newName);
    fs.renameSync(distDir, newPath);
    console.log(`Папка dist переименована в ${newName}.`);
    console.log('Вы можете удалить её позже вручную.');
  } catch (err) {
    console.error('Не удалось переименовать папку dist:', err.message);
    console.warn('Убедитесь, что все процессы Electron закрыты, и удалите папку dist вручную перед следующей сборкой.');
    process.exit(1);
  }
} else {
  console.log('Очистка завершена успешно.');
}
