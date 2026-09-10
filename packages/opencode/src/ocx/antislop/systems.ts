export type SystemsSlopFinding = {
  readonly rule: string
  readonly severity: "warning" | "blocker"
  readonly evidence: string
  readonly fix: string
}

export function scanSystems(content: string, filePath: string): readonly SystemsSlopFinding[] {
  const findings: SystemsSlopFinding[] = []
  const isC = /\.(?:c|h)$/i.test(filePath)
  const isCpp = /\.(?:cc|cpp|cxx|hpp)$/i.test(filePath)
  const isAndroid = /\.(?:java|kt)$/i.test(filePath) || /Android\.bp/i.test(filePath)
  const isKernel = /(?:kernel|drivers|arch|fs|net|sound|include\/linux)[/\\]/i.test(filePath) || isC

  const lines = content.split("\n")

  if (isC || isCpp) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (
        /\b(?:kmalloc|kzalloc|vmalloc|devm_kmalloc|devm_kzalloc|malloc)\s*\(/.test(trimmed) &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*")
      ) {
        const nextLines = lines.slice(i + 1, i + 6).map((l) => l.trim()).join(" ")
        if (!/(?:if\s*\(!|if\s*\(.*==\s*NULL|if\s*\(IS_ERR)/i.test(nextLines)) {
          findings.push({
            rule: "K-unchecked-alloc",
            severity: "blocker",
            evidence: `memory allocation at line ${i + 1} without null/IS_ERR return check`,
            fix: "always check allocation return pointer (if (!ptr) return -ENOMEM;)",
          })
        }
      }

      if (isKernel && /\b(?:spin_lock|spin_lock_irqsave|read_lock|write_lock)\s*\(/.test(trimmed)) {
        const nextBlock = lines.slice(i + 1, i + 15).map((l) => l.trim()).join(" ")
        if (/\b(?:msleep|ssleep|usleep_range|mutex_lock|schedule\(\)|down_interruptible|copy_from_user|copy_to_user)\b/.test(nextBlock)) {
          findings.push({
            rule: "K-sleep-in-atomic",
            severity: "blocker",
            evidence: `blocking or sleeping operation called while holding spinlock at line ${i + 1}`,
            fix: "never sleep, schedule, or access user memory while holding a spinlock",
          })
        }
        if (/\bGFP_KERNEL\b/.test(nextBlock)) {
          findings.push({
            rule: "K-gfp-kernel-in-atomic",
            severity: "blocker",
            evidence: `GFP_KERNEL allocation used in spinlock context at line ${i + 1}`,
            fix: "use GFP_ATOMIC when allocating within a spinlock or atomic section",
          })
        }
      }

      const hasUserPointers = isKernel && /\b__user\b/.test(content)
      const hasCopyUser = /copy_(?:from|to)_user|get_user|put_user/i.test(content)
      if (hasUserPointers && !hasCopyUser) {
        if (/=\s*\*|\*.*=/.test(trimmed) && !trimmed.includes("__user") && !trimmed.startsWith("//")) {
          findings.push({
            rule: "K-direct-user-dereference",
            severity: "blocker",
            evidence: `potential direct user pointer dereference at line ${i + 1}`,
            fix: "use copy_from_user() or copy_to_user() to safely transfer user memory",
          })
        }
      }

      if (/\bcopy_from_user\s*\(/.test(trimmed)) {
        const nextLines = lines.slice(i, i + 4).map((l) => l.trim()).join(" ")
        if (!/if\s*\(.*copy_from_user|if\s*\(ret|if\s*\(res/.test(nextLines)) {
          findings.push({
            rule: "K-unchecked-user-copy",
            severity: "blocker",
            evidence: `copy_from_user at line ${i + 1} without checking uncopied byte count`,
            fix: "check return value: if (copy_from_user(...)) return -EFAULT;",
          })
        }
      }
    }
  }

  if (isAndroid) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (/\bwriteByteArray\s*\([^)]*\.toByteArray\(\)\)/.test(trimmed) || /\bwriteBlob\b/.test(trimmed)) {
        findings.push({
          rule: "A-binder-large-payload",
          severity: "warning",
          evidence: `direct large buffer serialization to Parcel at line ${i + 1}`,
          fix: "stream large data via Ashmem, MemoryFile, or ParcelFileDescriptor to prevent TransactionTooLargeException",
        })
      }
    }
  }

  return findings
}

export * as SystemsSlop from "./systems"
