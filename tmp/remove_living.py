#!/usr/bin/env python3
"""
Remove or anonymize living persons from GEDCOM files

This script processes a GEDCOM file and removes or anonymizes information
about living persons to protect privacy before publishing.

A person is considered living if:
- No death date (DEAT) is recorded AND
- Birth date is within the last N years (default: 110)

Usage:
    python remove_living.py input.ged output.ged [--max-age 110] [--remove]

Options:
    --max-age N     Consider persons born in last N years as potentially living (default: 110)
    --remove        Remove living persons entirely (default: anonymize)

Author: Claude Code
Date: 2026-01-26
"""

import argparse
import sys
from datetime import datetime
from typing import Optional

try:
    from ged4py import GedcomReader
    from ged4py.model import Record
except ImportError:
    print("❌ Error: ged4py not installed")
    print("\nInstall with: pip install ged4py")
    sys.exit(1)


def extract_year(date_value) -> Optional[int]:
    """
    Extract year from GEDCOM date value.

    Args:
        date_value: GEDCOM date value (can be string or DateValueSimple object)

    Returns:
        Year as integer, or None if can't parse
    """
    if not date_value:
        return None

    # Convert to string if it's a ged4py date object
    date_str = str(date_value)

    import re
    # Try to find 4-digit year
    match = re.search(r'\b(1\d{3}|20\d{2})\b', date_str)
    if match:
        return int(match.group(1))

    return None


def is_living(person: Record, max_age: int = 110) -> bool:
    """
    Determine if a person is likely living.

    Args:
        person: GEDCOM INDI record
        max_age: Maximum age in years to consider someone potentially living

    Returns:
        True if person is likely living, False otherwise
    """
    # Check for death event
    death_events = [sub for sub in person.sub_records if sub.tag == 'DEAT']
    if death_events:
        return False

    # Get birth year
    birth_events = [sub for sub in person.sub_records if sub.tag == 'BIRT']
    birth_year = None

    if birth_events:
        for birth in birth_events:
            # Look for DATE sub-tag
            date_records = [sub for sub in birth.sub_records if sub.tag == 'DATE']
            if date_records:
                birth_year = extract_year(date_records[0].value)
                break

    # If no birth year, assume potentially living (conservative approach)
    if birth_year is None:
        return True

    # Check if birth year is within max_age years
    current_year = datetime.now().year
    age = current_year - birth_year
    return age <= max_age


def anonymize_person(person: Record) -> None:
    """
    Anonymize a living person's INDI record in-place.

    Removes/replaces:
    - NAME → "Living Person"
    - Birth/Death dates and places
    - Photos (OBJE)
    - Notes (NOTE)
    - Sources (SOUR)
    - Occupations (OCCU)
    - Residences (RESI)
    - Education (EDUC)

    Keeps:
    - SEX (for family tree structure)
    - Family links (FAMC/FAMS)
    """
    # Build list of sub-records to keep
    keep_tags = {'SEX', 'FAMC', 'FAMS', 'CHAN'}
    new_sub_records = []

    # Find existing NAME record and replace it, or create new one
    name_found = False
    for sub in person.sub_records:
        if sub.tag == 'NAME':
            # Replace the value
            sub.value = 'Living /Person/'
            # Remove sub-records (GIVN, SURN, etc.)
            sub.sub_records = []
            new_sub_records.append(sub)
            name_found = True
        elif sub.tag in keep_tags:
            new_sub_records.append(sub)

    # If no NAME was found, we need to create one (edge case)
    # For simplicity, we'll just skip it as all persons should have a NAME

    # Replace sub_records
    person.sub_records = new_sub_records


def process_gedcom(input_file: str, output_file: str, max_age: int = 110,
                   remove_living: bool = False) -> dict:
    """
    Process GEDCOM file and remove/anonymize living persons.

    Args:
        input_file: Path to input GEDCOM file
        output_file: Path to output GEDCOM file
        max_age: Maximum age to consider someone living
        remove_living: If True, remove living persons entirely; if False, anonymize

    Returns:
        Dictionary with statistics
    """
    # Parse input GEDCOM
    print("Loading GEDCOM...")
    with GedcomReader(input_file, encoding='utf-8') as parser:
        records = list(parser.records0())

    stats = {
        'total_persons': 0,
        'living_persons': 0,
        'anonymized': 0,
        'removed': 0,
        'kept': 0
    }

    living_ids = set()

    # Process INDI records
    for record in records:
        if record.tag == 'INDI':
            stats['total_persons'] += 1

            if is_living(record, max_age):
                stats['living_persons'] += 1
                living_ids.add(record.xref_id)

                if remove_living:
                    stats['removed'] += 1
                    # Mark for removal
                    record._remove = True
                else:
                    stats['anonymized'] += 1
                    anonymize_person(record)
            else:
                stats['kept'] += 1

    # Remove marked records if needed
    if remove_living:
        records = [r for r in records if not hasattr(r, '_remove')]

    # Write output GEDCOM
    print("Writing output...")
    with open(output_file, 'w', encoding='utf-8') as f:
        for record in records:
            write_record(f, record)

    return stats


def write_record(f, record: Record, level: int = 0) -> None:
    """
    Write a GEDCOM record to file.

    Args:
        f: File handle
        record: GEDCOM record to write
        level: Current level in hierarchy (for recursion)
    """
    # Build line
    parts = [str(record.level)]

    if record.xref_id:
        # xref_id might already include @ symbols
        xref = record.xref_id
        if not xref.startswith('@'):
            xref = f'@{xref}@'
        parts.append(xref)

    parts.append(str(record.tag))

    if record.value:
        # Convert value to string (might be complex object)
        parts.append(str(record.value))

    line = ' '.join(parts)
    f.write(line + '\n')

    # Write sub-records recursively
    for sub in record.sub_records:
        write_record(f, sub, level + 1)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Remove or anonymize living persons from GEDCOM files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Anonymize living persons (default)
  python remove_living.py input.ged output_public.ged

  # Remove living persons entirely
  python remove_living.py input.ged output_public.ged --remove

  # Use 100 years as threshold
  python remove_living.py input.ged output_public.ged --max-age 100
        """
    )

    parser.add_argument('input', help='Input GEDCOM file')
    parser.add_argument('output', help='Output GEDCOM file')
    parser.add_argument('--max-age', type=int, default=110,
                       help='Max age in years to consider living (default: 110)')
    parser.add_argument('--remove', action='store_true',
                       help='Remove living persons entirely (default: anonymize)')

    args = parser.parse_args()

    print("="*60)
    print("GEDCOM Privacy Filter - Remove/Anonymize Living Persons")
    print("="*60)
    print(f"\nInput:  {args.input}")
    print(f"Output: {args.output}")
    print(f"Max age: {args.max_age} years")
    print(f"Mode: {'REMOVE' if args.remove else 'ANONYMIZE'}")
    print()

    # Process
    try:
        stats = process_gedcom(
            args.input,
            args.output,
            max_age=args.max_age,
            remove_living=args.remove
        )
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Report
    print("\n" + "="*60)
    print("✓ DONE!")
    print("="*60)
    print(f"\nStatistics:")
    print(f"  Total persons:    {stats['total_persons']}")
    print(f"  Living persons:   {stats['living_persons']}")
    print(f"  Kept (deceased):  {stats['kept']}")

    if args.remove:
        print(f"  Removed:          {stats['removed']}")
    else:
        print(f"  Anonymized:       {stats['anonymized']}")

    print(f"\n✓ Output saved to: {args.output}")
    print("\n⚠️  IMPORTANT:")
    print("  - Always review the output file before publishing")
    print("  - Consider legal requirements in your jurisdiction")
    print("  - Respect privacy of living individuals")
    print()

    return 0


if __name__ == '__main__':
    sys.exit(main())
