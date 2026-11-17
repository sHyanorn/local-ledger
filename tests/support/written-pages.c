// Writes to a file the pages of a process that hold what it has written,
// with the process suspended: those the kernel reports dirty, and those it
// has compressed, which it reports paged out and not dirty, so a core of
// modified memory leaves them out. Prints the bytes of compressed pages
// written. Needs root.
//
// written-pages <pid> <file>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdio.h>
#include <stdlib.h>

/** Pages whose dispositions one query asks for. */
#define QUERY_PAGES 4096

static void fail(const char *call, kern_return_t kr) {
  fprintf(stderr, "%s: %s (%d)\n", call, mach_error_string(kr), kr);
  exit(1);
}

static void fail_in(const char *call, mach_vm_address_t page,
                    mach_vm_address_t start, mach_vm_size_t size,
                    const vm_region_submap_info_data_64_t *info,
                    kern_return_t kr) {
  fprintf(stderr,
          "%s at 0x%llx, in the region at 0x%llx of 0x%llx bytes, protection "
          "%d, user_tag %u, share_mode %d: %s (%d)\n",
          call, page, start, size, info->protection, info->user_tag,
          info->share_mode, mach_error_string(kr), kr);
  exit(1);
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: written-pages <pid> <file>\n");
    return 2;
  }
  task_t task;
  kern_return_t kr = task_for_pid(mach_task_self(), atoi(argv[1]), &task);
  if (kr != KERN_SUCCESS) fail("task_for_pid", kr);
  FILE *out = fopen(argv[2], "wb");
  if (!out) {
    perror(argv[2]);
    return 1;
  }
  // The kernel resumes the process if this one ends before resuming it.
  task_suspension_token_t suspended;
  kr = task_suspend2(task, &suspended);
  if (kr != KERN_SUCCESS) fail("task_suspend2", kr);

  const mach_vm_size_t page = vm_page_size;
  char *bytes = malloc(page);
  static int dispositions[QUERY_PAGES];
  unsigned long long compressed = 0;
  mach_vm_address_t start = 0;
  natural_t depth = 0;
  for (;;) {
    mach_vm_size_t size;
    vm_region_submap_info_data_64_t info;
    mach_msg_type_number_t count = VM_REGION_SUBMAP_INFO_COUNT_64;
    kr = mach_vm_region_recurse(task, &start, &size, &depth,
                                (vm_region_recurse_info_t)&info, &count);
    // No region at or above start.
    if (kr == KERN_INVALID_ADDRESS) break;
    if (kr != KERN_SUCCESS) fail("mach_vm_region_recurse", kr);
    if (info.is_submap) {
      depth++;
      continue;
    }
    // As on Linux, a region the process cannot read is not read.
    if (info.protection & VM_PROT_READ) {
      for (mach_vm_size_t done = 0; done < size / page;) {
        mach_vm_address_t at = start + done * page;
        mach_vm_size_t pages = size / page - done;
        if (pages > QUERY_PAGES) pages = QUERY_PAGES;
        kr = mach_vm_page_range_query(task, at, pages * page,
                                      (mach_vm_address_t)dispositions, &pages);
        if (kr != KERN_SUCCESS || pages == 0) {
          fail_in("mach_vm_page_range_query", at, start, size, &info, kr);
        }
        for (mach_vm_size_t i = 0; i < pages; i++) {
          const int disposition = dispositions[i];
          if (!(disposition &
                (VM_PAGE_QUERY_PAGE_DIRTY | VM_PAGE_QUERY_PAGE_PAGED_OUT))) {
            continue;
          }
          mach_vm_size_t read = 0;
          kr = mach_vm_read_overwrite(task, at + i * page, page,
                                      (mach_vm_address_t)bytes, &read);
          if (kr != KERN_SUCCESS || read != page) {
            fail_in("mach_vm_read_overwrite", at + i * page, start, size,
                    &info, kr);
          }
          if (fwrite(bytes, 1, page, out) != page) {
            perror(argv[2]);
            return 1;
          }
          if (disposition & VM_PAGE_QUERY_PAGE_PAGED_OUT) compressed += page;
        }
        done += pages;
      }
    }
    start += size;
  }

  kr = task_resume2(suspended);
  if (kr != KERN_SUCCESS) fail("task_resume2", kr);
  if (fclose(out) != 0) {
    perror(argv[2]);
    return 1;
  }
  printf("%llu\n", compressed);
  return 0;
}
