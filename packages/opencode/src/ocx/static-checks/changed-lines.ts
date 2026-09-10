export function changedLineSet(previousContent: string, currentContent: string): Set<number> {
  const prevLines = previousContent.split("\n")
  const currLines = currentContent.split("\n")

  let prefix = 0
  while (
    prefix < prevLines.length &&
    prefix < currLines.length &&
    prevLines[prefix] === currLines[prefix]
  ) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < prevLines.length - prefix &&
    suffix < currLines.length - prefix &&
    prevLines[prevLines.length - 1 - suffix] === currLines[currLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const changed = new Set<number>()
  for (let line = prefix + 1; line <= currLines.length - suffix; line++) {
    changed.add(line)
  }
  return changed
}
